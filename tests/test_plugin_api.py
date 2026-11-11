import hashlib
import importlib.util
import io
import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_api(data_dir: Path):
    storage = types.ModuleType("plugins.plugin_storage")
    storage.plugin_data_dir = lambda name: data_dir
    package = types.ModuleType("plugins")
    package.plugin_storage = storage
    sys.modules["plugins"] = package
    sys.modules["plugins.plugin_storage"] = storage
    spec = importlib.util.spec_from_file_location("doom_plugin_api", ROOT / "dashboard" / "plugin_api.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def archive_with(member: str, payload: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr(member, payload)
    return buffer.getvalue()


class PluginApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.api = load_api(self.dir)
        self.addCleanup(self.tmp.cleanup)

    def pin(self, wad: bytes) -> bytes:
        archive = archive_with(self.api.FREEDOOM_MEMBER, wad)
        self.api.FREEDOOM_ZIP_SHA256 = hashlib.sha256(archive).hexdigest()
        self.api.FREEDOOM_WAD_SHA256 = hashlib.sha256(wad).hexdigest()
        return archive

    def test_library_lists_only_iwads_with_safe_names(self):
        (self.dir / "doom.wad").write_bytes(b"IWAD" + b"\0" * 8)
        (self.dir / "levels.wad").write_bytes(b"PWAD" + b"\0" * 8)
        (self.dir / "notes.txt").write_bytes(b"IWAD")
        library = self.api.library(self.dir)
        self.assertEqual([wad["name"] for wad in library["wads"]], ["doom.wad"])
        self.assertEqual(library["wads"][0]["source"], "user")
        self.assertFalse(library["freedoom"]["installed"])

    def test_install_writes_verified_freedoom_once(self):
        wad = b"IWAD" + b"freedoom"
        archive = self.pin(wad)
        calls = []

        def fetch():
            calls.append(1)
            return archive

        self.api.install_freedoom(self.dir, fetch)
        self.api.install_freedoom(self.dir, fetch)
        self.assertEqual((self.dir / "freedoom1.wad").read_bytes(), wad)
        self.assertEqual(len(calls), 1)
        self.assertTrue(self.api.library(self.dir)["freedoom"]["installed"])

    def test_install_refuses_archive_that_fails_the_pinned_checksum(self):
        self.pin(b"IWAD" + b"freedoom")
        tampered = archive_with(self.api.FREEDOOM_MEMBER, b"IWAD" + b"tampered")
        with self.assertRaises(ValueError):
            self.api.install_freedoom(self.dir, lambda: tampered)
        self.assertFalse((self.dir / "freedoom1.wad").exists())

    def test_wad_route_serves_listed_files_only(self):
        from fastapi import HTTPException

        (self.dir / "doom.wad").write_bytes(b"IWAD" + b"\0" * 8)
        self.assertEqual(Path(self.api.get_wad("doom.wad").path), self.dir / "doom.wad")
        for name in ("missing.wad", "../doom.wad", "notes.txt"):
            with self.assertRaises(HTTPException):
                self.api.get_wad(name)


if __name__ == "__main__":
    unittest.main()
