from __future__ import annotations
from flask import Blueprint, jsonify, request
from services.cards_service import shape_card

cards_bp = Blueprint("cards_bp", __name__)

@cards_bp.post("/api/cards/preview")
def preview_card():
    cell = request.get_json(force=True, silent=True) or {}
    return jsonify({"card": shape_card(cell)})
