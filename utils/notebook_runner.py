# utils/notebook_runner.py — simple papermill wrapper using a known-good kernel
from __future__ import annotations
from pathlib import Path
import papermill as pm

def run_notebook(input_path: str, output_path: str, parameters: dict | None = None):
    ip = str(Path(input_path))
    op = str(Path(output_path))
    params = parameters or {}

    # Use the kernel we just installed in your current env
    KERNEL = "avu-base"  # created via: python -m ipykernel install --user --name avu-base

    pm.execute_notebook(
        ip, op,
        parameters=params,
        kernel_name=KERNEL,
        progress_bar=False,
        request_save_on_cell_execute=False,
        report_mode=False,
    )
