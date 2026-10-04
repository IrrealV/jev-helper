"""Strict, bounded in-memory Pi patch primitives. No filesystem or CLI operations."""
from collections.abc import Mapping
import gzip
import hashlib
from io import BytesIO
import re
import tarfile
import zlib

PAYLOAD_PATHS = frozenset({
    "packages/agent/src/agent-loop.ts",
    "packages/agent/src/index.ts",
    "packages/agent/src/tool-execution.ts",
    "packages/agent/test/tool-execution.test.ts",
    "packages/coding-agent/src/index.ts",
    "packages/coding-agent/src/core/agent-session.ts",
    "packages/coding-agent/src/core/agent-session-runtime.ts",
    "packages/coding-agent/src/core/event-bus.ts",
    "packages/coding-agent/src/core/tool-invocation-scope.ts",
    "packages/coding-agent/src/core/extensions/index.ts",
    "packages/coding-agent/src/core/extensions/types.ts",
    "packages/coding-agent/src/core/extensions/wrapper.ts",
    "packages/coding-agent/src/core/extensions/runner.ts",
    "packages/coding-agent/src/core/tools/tool-definition-wrapper.ts",
    "packages/coding-agent/test/suite/harness.ts",
    "packages/coding-agent/test/suite/agent-session-tool-pipeline.test.ts",
    "packages/coding-agent/test/suite/agent-session-tool-invocation.test.ts",
    "packages/coding-agent/test/suite/agent-session-tool-invocation-guards.test.ts",
    "packages/coding-agent/test/suite/agent-session-tool-invocation-origin.test.ts",
    "packages/coding-agent/test/suite/agent-session-tool-invocation-lifecycle.test.ts",
    "packages/coding-agent/test/suite/host-invocation-lifecycle-fixture.ts",
    "packages/coding-agent/test/suite/agent-session-tool-invocation-replacement.test.ts",
    "packages/coding-agent/test/suite/host-invocation-replacement-fixture.ts",
})
LICENSE_PATH = "LICENSE"  # Metadata, never a patch target.
MAX_TEXT_BYTES = 512 * 1024
MAX_PATCH_BYTES = 32 * 1024 * 1024
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
MAX_EXPANDED_BYTES = 128 * 1024 * 1024
_LABELS = {("before", "after"), ("initial", "final"),
           ("inherited-baseline", "successor"), ("baseline", "candidate"), ("a", "b")}
_HUNK = re.compile(rb"@@ -([0-9]{1,9})(?:,([0-9]{1,9}))? \+([0-9]{1,9})(?:,([0-9]{1,9}))? @@(?: [^\n]*)?\n")
_NO_NEWLINE = b"\\ No newline at end of file\n"


class ReconstructionError(ValueError):
    """Input does not satisfy the strict reconstruction contract."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ReconstructionError(message)


def _text(data: bytes, limit: int = MAX_TEXT_BYTES) -> None:
    _require(isinstance(data, bytes) and len(data) <= limit, "Text exceeds byte bound or is not bytes")
    try:
        data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ReconstructionError("Text is not UTF-8") from error
    _require(b"\x00" not in data, "NUL is not ordinary source text")


def _lines(data: bytes) -> list[bytes]:
    # Only LF separates source lines; CR and other Unicode separators are payload.
    parts = data.split(b"\n")
    return [part + b"\n" for part in parts[:-1]] + ([parts[-1]] if parts[-1] else [])


def _header(line: bytes, marker: bytes, label: str) -> str:
    prefix = marker + label.encode("ascii") + b"/"
    _require(line.startswith(prefix) and line.endswith(b"\n"), "Wrong header or label")
    path = line[len(prefix):-1].decode("utf-8")
    _require(path in PAYLOAD_PATHS, "Header path is not an exact payload path")
    return path


def _hunk(lines: list[bytes], index: int) -> tuple[int, int, list[bytes], list[bytes], int]:
    match = _HUNK.fullmatch(lines[index])
    _require(match is not None, "Malformed hunk header")
    assert match is not None
    start_old, count_old, start_new, count_new = (int(value) if value is not None else 1 for value in match.groups())
    _require((count_old == 0 or start_old > 0) and (count_new == 0 or start_new > 0), "Invalid line origin")
    _require(count_old + count_new > 0, "Empty hunk")
    old: list[bytes] = []
    new: list[bytes] = []
    index += 1
    while len(old) < count_old or len(new) < count_new:
        _require(index < len(lines), "Truncated hunk")
        record = lines[index]
        _require(record[:1] in (b" ", b"-", b"+"), "Malformed hunk record")
        content = record[1:]
        index += 1
        if index < len(lines) and lines[index] == _NO_NEWLINE:
            content = content[:-1]
            _require(bool(content), "No-newline marker cannot describe an empty line")
            index += 1
        if record[:1] != b"+":
            old.append(content)
        if record[:1] != b"-":
            new.append(content)
        _require(len(old) <= count_old and len(new) <= count_new, "Hunk count mismatch")
    return start_old - bool(count_old), start_new - bool(count_new), old, new, index


def _apply_file(source: bytes, lines: list[bytes], index: int, creation: bool) -> tuple[bytes, int]:
    original = _lines(source)
    output: list[bytes] = []
    cursor, previous_start, hunks = 0, -1, 0
    while index < len(lines) and lines[index].startswith(b"@@"):
        old_at, new_at, old, new, index = _hunk(lines, index)
        _require(cursor <= old_at <= len(original) and old_at > previous_start, "Overlapping or out-of-range hunk")
        _require(original[old_at:old_at + len(old)] == old, "Exact old context/deletion mismatch")
        output.extend(original[cursor:old_at])
        _require(new_at == len(output), "Incorrect new position")
        if creation:
            _require(hunks == 0 and old_at == 0 and not old and new_at == 0 and bool(new), "Invalid declared creation")
        output.extend(new)
        cursor, previous_start = old_at + len(old), old_at
        hunks += 1
    _require(hunks > 0, "Missing file hunks")
    output.extend(original[cursor:])
    _require(all(line.endswith(b"\n") for line in output[:-1]), "No-newline marker before end of new file")
    result = b"".join(output)
    _text(result)
    return result, index


def apply_unified_diff(base: Mapping[str, bytes], patch: bytes, *, old_label: str,
                       new_label: str, creations: frozenset[str] = frozenset()) -> dict[str, bytes]:
    """Apply plain unified diff atomically. Labels and absent creations are caller declarations.

    Git metadata, renames, /dev/null, timestamps, empty patches and empty creation
    hunks are deliberately unsupported. LICENSE must be kept separately from base.
    """
    _require((old_label, new_label) in _LABELS, "Unsupported declared label pair")
    _require(creations <= PAYLOAD_PATHS, "Unknown creation path")
    for path, data in base.items():
        _require(path in PAYLOAD_PATHS, "Unknown base path")
        _text(data)
    _require(not creations.intersection(base), "Creation requires absent predecessor")
    _text(patch, MAX_PATCH_BYTES)
    _require(bool(patch) and patch.endswith(b"\n"), "Empty or unterminated patch")
    lines = _lines(patch)
    result = dict(base)
    seen: set[str] = set()
    index = 0
    while index < len(lines):
        _require(index + 1 < len(lines), "Truncated file headers")
        path = _header(lines[index], b"--- ", old_label)
        _require(_header(lines[index + 1], b"+++ ", new_label) == path, "Mismatched file paths")
        _require(path not in seen, "Duplicate file patch")
        _require(path in base or path in creations, "Undeclared missing predecessor")
        seen.add(path)
        source = b"" if path in creations else base[path]
        result[path], index = _apply_file(source, lines, index + 2, path in creations)
    _require(creations <= seen, "Unused creation declaration")
    return result


class _BoundedGzipReader:
    """Bound decompression, including skipped tar data and extended metadata."""
    def __init__(self, source: gzip.GzipFile) -> None:
        self.source = source
        self.remaining = MAX_EXPANDED_BYTES

    def read(self, size: int) -> bytes:
        data = self.source.read(min(size, self.remaining + 1))
        self.remaining -= len(data)
        _require(self.remaining >= 0, "Expanded archive exceeds byte bound")
        return data


def _selected_path(member: tarfile.TarInfo) -> tuple[str, str] | None:
    name = member.name
    _require(not name.endswith("/") or member.isdir(), "Non-directory has trailing slash")
    components = (name[:-1] if name.endswith("/") else name).split("/")
    _require("\\" not in name and all(part not in ("", ".", "..") for part in components)
             and not any(ord(char) < 32 or ord(char) == 127 for char in name), "Unsafe archive path")
    allowed = PAYLOAD_PATHS | {LICENSE_PATH}
    # Suffix detection is rejection-only: never normalize a nested prefix into a target.
    candidates = [path for path in allowed if name == path or name.endswith("/" + path)]
    if not candidates:
        return None
    root, separator, path = name.partition("/")
    _require(bool(separator) and path in allowed and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", root) is not None,
             "Selected member requires one safe top-level prefix")
    _require(member.type in (tarfile.REGTYPE, tarfile.AREGTYPE) and member.sparse is None,
             "Selected member must be an ordinary regular file")
    _require(0 <= member.size <= MAX_TEXT_BYTES, "Selected member exceeds text bound")
    return root, path


def select_archive(archive: bytes | BytesIO, expected_sha256: str) -> tuple[dict[str, bytes], str]:
    """Verify opaque gzip-tar bytes and select public text without extraction to disk.

    Returns only present allowlisted members and their discovered root; absence is
    NOT proof of an expected base inventory. BytesIO position is left unchanged.
    Unselected members are never opened; streaming still decompresses tar framing.
    """
    _require(isinstance(expected_sha256, str) and re.fullmatch(r"[0-9a-fA-F]{64}", expected_sha256) is not None,
             "Expected SHA-256 must be 32-byte hexadecimal")
    _require(isinstance(archive, (bytes, BytesIO)), "Archive must be bytes or BytesIO")
    size = archive.getbuffer().nbytes if isinstance(archive, BytesIO) else len(archive)
    _require(size <= MAX_ARCHIVE_BYTES, "Compressed archive exceeds byte bound")
    raw = archive.getvalue() if isinstance(archive, BytesIO) else archive
    _require(hashlib.sha256(raw).hexdigest() == expected_sha256.lower(), "Archive SHA-256 mismatch")
    selected: dict[str, bytes] = {}
    root = ""
    try:
        with gzip.GzipFile(fileobj=BytesIO(raw), mode="rb") as compressed:
            with tarfile.open(fileobj=_BoundedGzipReader(compressed), mode="r|") as tar:
                for member in tar:
                    target = _selected_path(member)
                    if target is None:
                        continue
                    prefix, path = target
                    _require(not root or root == prefix, "Selected members have conflicting roots")
                    _require(path not in selected, "Duplicate selected member")
                    root = prefix
                    stream = tar.extractfile(member)
                    _require(stream is not None, "Selected member has no payload")
                    assert stream is not None
                    with stream:
                        data = stream.read(MAX_TEXT_BYTES + 1)
                    _require(len(data) == member.size, "Truncated selected member")
                    _text(data)
                    selected[path] = data
    except (tarfile.TarError, OSError, EOFError, zlib.error) as error:
        raise ReconstructionError("Invalid compressed tar archive") from error
    _require(bool(root), "No selected archive members")
    return selected, root
