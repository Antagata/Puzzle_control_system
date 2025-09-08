# utils/notebook_runner.py — simple papermill wrapper using a known-good kernel
from __future__ import annotations
from pathlib import Path
import papermill as pm
import nbformat
from papermill.exceptions import PapermillExecutionError

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

def notebook_has_parameters_cell(nb_path: str) -> bool:
    nb = nbformat.read(nb_path, as_version=4)
    for cell in nb.cells:
        tags = cell.get("metadata", {}).get("tags", [])
        if isinstance(tags, list) and "parameters" in tags:
            return True
    return False

def run_notebook_safely(input_nb: str, output_nb: str, parameters: dict | None = None, kernel_name: str | None = None):
    """Execute notebook with optional parameters. Returns dict(status=…, message=…)."""
    params = parameters or {}
    try:
        if params and not notebook_has_parameters_cell(input_nb):
            return {"status": "skipped", "message": "Notebook missing 'parameters' cell; parameters ignored."}
        pm.execute_notebook(
            input_path=input_nb,
            output_path=output_nb,
            parameters=params,
            kernel_name=kernel_name or "avu-base",
            progress_bar=False,
            request_save_on_cell_execute=False,
            report_mode=False,
        )
        return {"status": "completed", "message": "Notebook executed."}
    except PapermillExecutionError as e:
        return {"status": "failed", "message": f"Papermill error at cell {e.exec_count}: {e}"}
    except Exception as e:
        return {"status": "failed", "message": f"Notebook execution failed: {e}"}
