"""Synthetic, memory-only tests; run directly with Python -I -S -B."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "reconstruction", Path(__file__).resolve().parents[1] / "scripts/pi_host_patch_reconstruction.py")
assert SPEC is not None and SPEC.loader is not None
engine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engine)
P = "packages/agent/src/agent-loop.ts"
Q = "packages/agent/src/index.ts"
CAP = 512 * 1024


def diff(body: bytes, path: str = P, labels: tuple[str, str] = ("before", "after")) -> bytes:
    return f"--- {labels[0]}/{path}\n+++ {labels[1]}/{path}\n".encode() + body


def apply(base: dict[str, bytes], data: bytes, **kwargs: object) -> dict[str, bytes]:
    return engine.apply_unified_diff(base, data, old_label="before", new_label="after", **kwargs)


def archive(entries: list[tuple[str, bytes, bytes]]) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as tar:
        for name, value, kind in entries:
            member = tarfile.TarInfo(name)
            member.type = kind
            member.size = len(value) if kind == tarfile.REGTYPE else 0
            if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                member.linkname = "unused-target"
            tar.addfile(member, io.BytesIO(value) if kind == tarfile.REGTYPE else None)
    return output.getvalue()


def select(data: bytes, digest: str | None = None) -> tuple[dict[str, bytes], str]:
    return engine.select_archive(data, digest if digest is not None else hashlib.sha256(data).hexdigest())


class DiffTests(unittest.TestCase):
    def test_existing_multiple_hunks_and_atomic_success(self) -> None:
        base = {P: b"one\ntwo\nthree\nfour\n", Q: b"unchanged\r\n"}
        result = apply(base, diff(b"@@ -1,2 +1,2 @@ heading\n one\n-two\n+TWO\n@@ -4 +4 @@\n-four\n+FOUR\n"))
        self.assertEqual(result, {P: b"one\nTWO\nthree\nFOUR\n", Q: b"unchanged\r\n"})
        self.assertEqual(base[P], b"one\ntwo\nthree\nfour\n")
        self.assertIsNot(result, base)

    def test_creation_requires_absence_not_empty(self) -> None:
        data = diff(b"@@ -0,0 +1 @@\n+created\n")
        self.assertEqual(apply({}, data, creations=frozenset({P})), {P: b"created\n"})
        for base, declarations in [({}, frozenset()), ({P: b""}, frozenset({P})),
                                   ({P: b"old\n"}, frozenset({P}))]:
            with self.subTest(base=base, declarations=declarations), self.assertRaises(engine.ReconstructionError):
                apply(base, data, creations=declarations)

    def test_existing_zero_count_insertions_and_deletion(self) -> None:
        for base, body, expected in [
            (b"", b"@@ -0,0 +1 @@\n+x\n", b"x\n"),
            (b"a\nb\n", b"@@ -1,0 +2 @@\n+x\n", b"a\nx\nb\n"),
            (b"a\nb\n", b"@@ -0,0 +1 @@\n+x\n@@ -2 +3 @@\n-b\n+B\n", b"x\na\nB\n"),
            (b"a\nb\n", b"@@ -2,0 +3 @@\n+x\n", b"a\nb\nx\n"),
            (b"a\n", b"@@ -1 +0,0 @@\n-a\n", b""),
        ]:
            with self.subTest(body=body):
                self.assertEqual(apply({P: base}, diff(body)), {P: expected})

    def test_exact_newlines_and_no_newline_markers(self) -> None:
        for base, body, expected in [
            (b"a", b"@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n", b"b"),
            (b"a\n", b"@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n", b"b"),
            (b"a", b"@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n", b"b\n"),
            (b"a\r\n", b"@@ -1 +1 @@\n-a\r\n+b\r\n", b"b\r\n"),
            (b"a", b"@@ -1 +1 @@\n a\n\\ No newline at end of file\n", b"a"),
        ]:
            with self.subTest(body=body):
                self.assertEqual(apply({P: base}, diff(body)), {P: expected})

    def test_rejects_bad_context_counts_positions_and_trailing_data(self) -> None:
        bodies = [
            b"@@ -1 +1 @@\n-wrong\n+x\n", b"@@ -1,2 +1 @@\n-a\n+x\n",
            b"@@ -1 +2 @@\n-a\n+x\n", b"@@ -2 +2 @@\n-a\n+x\n",
            b"@@ -0 +1 @@\n-a\n+x\n", b"@@ -4,0 +5 @@\n+x\n",
            b"@@ -1 +1 @@\n-a\n+x\n+extra\n", b"@@ -1 +1 @@\n-a\n+x\ntrailer\n",
            b"@@ -1 +1 @@\n-a\n+x", b"@@ -1 +1 @@\n-a\n+x\n@@ -1 +1 @@\n-a\n+y\n",
            b"@@ -0,0 +1 @@\n+x\n\\ No newline at end of file\n",
            b"@@ -1 +1,2 @@\n-a\n+x\n\\ No newline at end of file\n+y\n",
            b"@@ -1 +1 @@\n-a\n+x\n\\ No newline at end of file\n\\ No newline at end of file\n",
            b"@@ -1 +1 @@\n-a\n+x\n@@ -1,0 +2 @@\n+y\n@@ -1,0 +3 @@\n+z\n",
            b"@@ -1,0 +1,0 @@\n", b"", b"@@ malformed @@\n",
            b"@@ -1 +1 @@\n-a\n+\n\\ No newline at end of file\n",
            b"@@ -1 +1 @@\n- a\n+x\n", b"@@ -1 +1 @@\n\\ No newline at end of file\n-a\n+x\n",
        ]
        for body in bodies:
            with self.subTest(body=body), self.assertRaises(engine.ReconstructionError):
                apply({P: b"a\nb\n"}, diff(body))

    def test_labels_paths_duplicates_and_atomic_failure(self) -> None:
        valid = diff(b"@@ -1 +1 @@\n-a\n+x\n")
        invalid = [valid + valid, valid.replace(b"after/", b"final/"),
                   valid.replace(f"+++ after/{P}".encode(), f"+++ after/{Q}".encode())]
        for name in ["/" + P, "../" + P, "x/../" + P, P.replace("/", "\\"),
                     "unknown.ts", "LICENSE", "x/" + P]:
            invalid.append(diff(b"@@ -1 +1 @@\n-a\n+x\n", name))
        invalid.append(valid + diff(b"@@ -1 +1 @@\n-wrong\n+y\n", Q))
        for data in invalid:
            base = {P: b"a\n", Q: b"b\n"}
            with self.subTest(data=data), self.assertRaises(engine.ReconstructionError):
                apply(base, data)
            self.assertEqual(base, {P: b"a\n", Q: b"b\n"})

    def test_declared_labels_and_creations(self) -> None:
        for labels in [("before", "after"), ("initial", "final"),
                       ("inherited-baseline", "successor"), ("baseline", "candidate"), ("a", "b")]:
            self.assertEqual(engine.apply_unified_diff({P: b"a\n"}, diff(b"@@ -1 +1 @@\n-a\n+b\n", labels=labels),
                             old_label=labels[0], new_label=labels[1]), {P: b"b\n"})
        for declarations in [frozenset({Q}), frozenset({"unknown.ts"})]:
            with self.assertRaises(engine.ReconstructionError):
                apply({P: b"a\n"}, diff(b"@@ -1 +1 @@\n-a\n+b\n"), creations=declarations)
        with self.assertRaises(engine.ReconstructionError):
            engine.apply_unified_diff({}, b"", old_label="../before", new_label="after")

    def test_creation_hunk_declaration_and_patch_bound(self) -> None:
        for body in [b"@@ -1,0 +1 @@\n+x\n", b"@@ -0,0 +2 @@\n+x\n",
                     b"@@ -1 +1 @@\n-a\n+x\n", b"@@ -0,0 +0,0 @@\n"]:
            with self.subTest(body=body), self.assertRaises(engine.ReconstructionError):
                apply({}, diff(body), creations=frozenset({P}))
        data = diff(b"@@ -1 +1 @@\n-a\n+b\n")
        with patch.object(engine, "MAX_PATCH_BYTES", len(data) - 1):
            with self.assertRaises(engine.ReconstructionError):
                apply({P: b"a\n"}, data)

    def test_text_and_size_bounds(self) -> None:
        for base, data in [({P: b"\xff"}, diff(b"@@ -0,0 +1 @@\n+x\n")),
                           ({P: b""}, diff(b"@@ -0,0 +1 @@\n+\xff\n")),
                           ({P: b"x" * (CAP + 1)}, b""),
                           ({P: b""}, diff(b"@@ -0,0 +1 @@\n+" + b"x" * CAP + b"\n")),
                           ({"../bad": b""}, b"")]:
            with self.subTest(base_size=sum(map(len, base.values()))), self.assertRaises(engine.ReconstructionError):
                apply(base, data)


class ArchiveTests(unittest.TestCase):
    def test_selected_only_exact_bytes_root_and_bytesio_position(self) -> None:
        data = archive([("public-root/" + P, b"source\r\n", tarfile.REGTYPE),
                        ("public-root/LICENSE", b"notice", tarfile.REGTYPE),
                        ("other-root/dependencies/ignored.txt", b"\xff" * (CAP + 1), tarfile.REGTYPE)])
        opened = []
        original = tarfile.TarFile.extractfile
        def spy(tar: tarfile.TarFile, member: tarfile.TarInfo):
            opened.append(member.name)
            return original(tar, member)
        stream = io.BytesIO(data)
        stream.seek(7)
        with patch.object(tarfile.TarFile, "extractfile", spy):
            selected, root = engine.select_archive(stream, hashlib.sha256(data).hexdigest())
        self.assertEqual(selected, {P: b"source\r\n", "LICENSE": b"notice"})
        self.assertEqual(root, "public-root")
        self.assertEqual(stream.tell(), 7)
        self.assertEqual(opened, ["public-root/" + P, "public-root/LICENSE"])
        self.assertEqual(select(data), (selected, root))

    def test_hash_and_compressed_input_validation(self) -> None:
        data = archive([("root/" + P, b"x", tarfile.REGTYPE)])
        for digest in ["0" * 64, "z" * 64, "a" * 63, "a" * 65]:
            with self.subTest(digest=digest), self.assertRaises(engine.ReconstructionError):
                select(data, digest)
        with self.assertRaises(engine.ReconstructionError):
            select(b"not a compressed tar")
        with patch.object(engine, "MAX_ARCHIVE_BYTES", len(data) - 1, create=True):
            with self.assertRaises(engine.ReconstructionError):
                select(data)

    def test_selected_links_duplicates_roots_and_unsafe_names(self) -> None:
        regular = ("root/" + P, b"x", tarfile.REGTYPE)
        cases = [[("root/" + P, b"", kind)] for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.DIRTYPE)]
        cases += [[regular, regular], [regular, ("other/" + Q, b"y", tarfile.REGTYPE)],
                  [], [("root/dependencies/ignored.txt", b"excluded", tarfile.REGTYPE)]]
        for name in ["/root/" + P, "../" + P, "./" + P, "root/../" + P,
                     "root//" + P, "root\\" + P, "root/x/../" + P, "C:/" + P]:
            cases.append([(name, b"x", tarfile.REGTYPE)])
        for entries in cases:
            with self.subTest(entries=entries), self.assertRaises(engine.ReconstructionError):
                select(archive(entries))

    def test_metadata_rejection_with_valid_selected_member(self) -> None:
        valid = ("root/" + P, b"x", tarfile.REGTYPE)
        for name in ["root/../" + Q, "nested/root/" + Q, "root/" + Q + "/"]:
            with self.subTest(name=name), self.assertRaises(engine.ReconstructionError):
                select(archive([valid, (name, b"x", tarfile.REGTYPE)]))

    def test_hash_checked_before_open_and_expanded_bound(self) -> None:
        data = archive([("root/" + P, b"x", tarfile.REGTYPE)])
        with patch.object(tarfile.TarFile, "extractfile") as opened:
            with self.assertRaises(engine.ReconstructionError):
                select(data, "0" * 64)
            opened.assert_not_called()
        with patch.object(engine, "MAX_EXPANDED_BYTES", 511):
            with self.assertRaises(engine.ReconstructionError):
                select(data)
        self.assertEqual(select(data, hashlib.sha256(data).hexdigest().upper()), ({P: b"x"}, "root"))
        self.assertEqual(len(engine.PAYLOAD_PATHS), 23)
        self.assertNotIn("LICENSE", engine.PAYLOAD_PATHS)

    def test_selected_text_size_and_utf8(self) -> None:
        for value in [b"\xff", b"x" * (CAP + 1)]:
            with self.subTest(size=len(value)), self.assertRaises(engine.ReconstructionError):
                select(archive([("root/" + P, value, tarfile.REGTYPE)]))


if __name__ == "__main__":
    unittest.main()
