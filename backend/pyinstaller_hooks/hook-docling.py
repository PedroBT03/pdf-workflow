"""Hook for PyInstaller to handle docling imports."""
from PyInstaller.utils.hooks import collect_data_files, copy_metadata

# Collect data files from docling and docling_core
datas = []

# Collect docling data files (models, etc)
try:
    datas += collect_data_files('docling')
except Exception:
    pass

try:
    datas += collect_data_files('docling_core')
except Exception:
    pass

try:
    datas += collect_data_files('docling_parse')
except Exception:
    pass

try:
    datas += collect_data_files('rapidocr')
except Exception:
    pass

# Copy metadata for docling and docling-ibm-models
try:
    datas += copy_metadata('docling')
except Exception:
    pass

try:
    datas += copy_metadata('docling-ibm-models')
except Exception:
    pass

try:
    datas += copy_metadata('docling_core')
except Exception:
    pass

try:
    datas += copy_metadata('docling-parse')
except Exception:
    pass

try:
    datas += copy_metadata('rapidocr')
except Exception:
    pass

# Hidden imports needed by docling
hiddenimports = [
    'docling',
    'docling_core',
    'docling_parse',
    'rapidocr',
    'docling.backend',
    'docling.backend.asciidoc_backend',
    'docling.datamodel',
    'docling.datamodel.document',
    'pdf2image',
    'pikepdf',
]
