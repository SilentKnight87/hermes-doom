"""Doom dashboard backend, mounted at /api/plugins/doom/.

Serves game data (IWAD files) from the plugin's data directory. Freedoom is
downloaded once, when the user asks for it, from the Freedoom project's
official GitHub release and checked against pinned SHA-256 digests before use.
"""
from __future__ import annotations

import hashlib
import io
import os
import re
import stat
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from plugins.plugin_storage import plugin_data_dir

router = APIRouter()

PLUGIN_NAME = "doom"
FREEDOOM_VERSION = "0.13.0"
FREEDOOM_URL = f"https://github.com/freedoom/freedoom/releases/download/v{FREEDOOM_VERSION}/freedoom-{FREEDOOM_VERSION}.zip"
FREEDOOM_ZIP_SHA256 = "3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59"
FREEDOOM_ZIP_BYTES = 24143781
FREEDOOM_MEMBER = f"freedoom-{FREEDOOM_VERSION}/freedoom1.wad"
FREEDOOM_WAD = "freedoom1.wad"
FREEDOOM_WAD_SHA256 = "7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d"
DOWNLOAD_TIMEOUT_SECONDS = 120
WAD_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.wad$", re.IGNORECASE)
IWAD_MAGIC = b"IWAD"

_download_lock = threading.Lock()


def data_dir() -> Path:
    return plugin_data_dir(PLUGIN_NAME)


OPEN_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)


def open_regular(path: Path) -> int:
    """Open a real file for reading.

    Symlinks are refused so nothing outside the data directory is read, and the open never
    blocks, so a FIFO or device planted there is rejected instead of hanging the request.
    """
    descriptor = os.open(path, OPEN_FLAGS)
    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
        os.close(descriptor)
        raise OSError("not a regular file")
    return descriptor


def read_regular(path: Path) -> Optional[bytes]:
    try:
        with os.fdopen(open_regular(path), "rb") as handle:
            return handle.read()
    except OSError:
        return None


def iwad_size(path: Path) -> Optional[int]:
    """Size of a real IWAD file, or None. The magic and the size come from one descriptor."""
    try:
        descriptor = open_regular(path)
    except OSError:
        return None
    with os.fdopen(descriptor, "rb") as handle:
        if handle.read(4) != IWAD_MAGIC:
            return None
        return os.fstat(handle.fileno()).st_size


def list_wads(directory: Path) -> list[dict]:
    wads = []
    for path in sorted(directory.iterdir()):
        size = iwad_size(path) if WAD_NAME.match(path.name) else None
        if size is not None:
            source = "freedoom" if path.name == FREEDOOM_WAD else "user"
            wads.append({"name": path.name, "bytes": size, "source": source})
    return wads


def display_path(path: Path) -> str:
    try:
        return "~/" + str(path.relative_to(Path.home()))
    except ValueError:
        return str(path)


def library(directory: Path) -> dict:
    wads = list_wads(directory)
    return {
        "wads": wads,
        "data_dir": display_path(directory),
        "freedoom": {
            "installed": any(wad["name"] == FREEDOOM_WAD for wad in wads),
            "version": FREEDOOM_VERSION,
            "url": FREEDOOM_URL,
            "download_bytes": FREEDOOM_ZIP_BYTES,
        },
    }


def extract_freedoom(archive: bytes) -> bytes:
    if hashlib.sha256(archive).hexdigest() != FREEDOOM_ZIP_SHA256:
        raise ValueError("Freedoom download does not match the pinned checksum")
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        wad = bundle.read(FREEDOOM_MEMBER)
    if hashlib.sha256(wad).hexdigest() != FREEDOOM_WAD_SHA256:
        raise ValueError("Freedoom WAD does not match the pinned checksum")
    return wad


def download_freedoom() -> bytes:
    with urllib.request.urlopen(FREEDOOM_URL, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        archive = response.read(FREEDOOM_ZIP_BYTES + 1)
    if len(archive) != FREEDOOM_ZIP_BYTES:
        raise ValueError("Freedoom download has an unexpected size")
    return archive


def install_freedoom(directory: Path, fetch=download_freedoom) -> Path:
    target = directory / FREEDOOM_WAD
    with _download_lock:
        installed = read_regular(target)
        if installed is not None and hashlib.sha256(installed).hexdigest() == FREEDOOM_WAD_SHA256:
            return target
        wad = extract_freedoom(fetch())
        descriptor, partial = tempfile.mkstemp(dir=directory, prefix=".freedoom-", suffix=".part")
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(wad)
            os.replace(partial, target)
        except OSError:
            Path(partial).unlink(missing_ok=True)
            raise
    return target


@router.get("/wads")
def get_wads():
    return library(data_dir())


@router.post("/freedoom")
def post_freedoom():
    directory = data_dir()
    try:
        install_freedoom(directory)
    except (OSError, ValueError, zipfile.BadZipFile, KeyError) as exc:
        raise HTTPException(502, f"Could not install Freedoom: {exc}") from exc
    return library(directory)


@router.get("/wad/{name}")
def get_wad(name: str):
    directory = data_dir()
    if not any(wad["name"] == name for wad in list_wads(directory)):
        raise HTTPException(404, "No such WAD in the plugin data directory")
    content = read_regular(directory / name)
    if content is None:
        raise HTTPException(404, "No such WAD in the plugin data directory")
    return Response(content, media_type="application/octet-stream")
