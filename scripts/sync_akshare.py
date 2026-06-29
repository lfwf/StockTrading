#!/usr/bin/env python3
"""Compatibility entrypoint for generating trading trainer cases.

The implementation lives in scripts/generate_training_cases.py.
Keep this filename because README/deploy scripts already call sync_akshare.py.
"""

from generate_training_cases import main


if __name__ == "__main__":
    main()
