# routes/__init__.py
# Keep this file minimal; do NOT register here.
from .calendar import calendar_bp
from .filters import filters_bp
from .cards import cards_bp
from .campaign_index import campaign_bp
from .leads import bp as leads_bp

__all__ = ["calendar_bp", "filters_bp", "cards_bp", "campaign_bp", "leads_bp"]
