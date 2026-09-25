#!/usr/bin/env python3
"""
Print the supported Cocos Creator scene generation workflow.

The old version of this file attempted to patch .scene JSON directly and wrote
to assets/scenes/main.scene even when that path did not exist. That approach is
unsafe for Creator 3.8 custom script components because script type references
must be produced by Creator itself.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILDER = ROOT / "tools" / "create-main-scene-in-creator.js"
TARGET = ROOT / "assets" / "scenes" / "main.scene"


def main() -> None:
    if not BUILDER.exists():
        raise SystemExit(f"Missing builder script: {BUILDER}")

    print("Scene builder is ready.")
    print()
    print(f"Builder script: {BUILDER}")
    print(f"Target scene:   {TARGET}")
    print()
    print("Open Cocos Creator 3.8, create/open an empty scene, then paste the")
    print("entire builder script into Developer -> Console. Save the generated")
    print("scene as assets/scenes/main.scene.")


if __name__ == "__main__":
    main()
