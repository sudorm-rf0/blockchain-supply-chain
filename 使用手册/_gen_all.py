# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _gen_helpers import build_doc
import _content_admin, _content_purchaser, _content_supplier, _content_comp

OUT = os.path.dirname(os.path.abspath(__file__))

MANUALS = [
    ("01-管理员使用手册.docx", _content_admin),
    ("02-采购方使用手册.docx", _content_purchaser),
    ("03-供货方使用手册.docx", _content_supplier),
    ("04-综合性使用手册.docx", _content_comp),
]

for fname, mod in MANUALS:
    doc = build_doc(mod.META, mod.BLOCKS)
    path = os.path.join(OUT, fname)
    doc.save(path)
    print("saved:", path)
print("ALL DONE")
