from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
out = root / "release" / "whatif-ai-prototype.zip"
out.parent.mkdir(parents=True, exist_ok=True)
exclude_parts = {"node_modules", ".git", "dist", ".venv", "__pycache__", ".pytest_cache"}
exclude_names = {".env", ".DS_Store"}
with ZipFile(out, "w", ZIP_DEFLATED) as zf:
    for path in root.rglob("*"):
        if not path.is_file() or path == out:
            continue
        rel = path.relative_to(root)
        if any(part in exclude_parts for part in rel.parts) or path.name in exclude_names:
            continue
        if path.suffix in {".log", ".pyc"}:
            continue
        zf.write(path, rel.as_posix())
print(out)
