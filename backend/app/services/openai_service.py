import os
import base64
import json
from typing import Dict, List, Any, Optional
from openai import OpenAI
from pathlib import Path
from app.core.config import settings

def encode_image_to_base64(image_path: str | Path) -> str:
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")

def generate_multi_orientation_template_b64(template_img_path: str | Path) -> str:
    """
    Renders a 4-angle reference strip showing the template symbol at:
    - 0° Standard (Horizontal / Upright)
    - 90° (Mounted on Vertical Wall - Right)
    - 180° (Mounted on Upper Wall / Inverted)
    - 270° (Mounted on Vertical Wall - Left)
    Renders with high-resolution slots (200px) so fine numerals and subscripts stay crisp.
    """
    from PIL import Image, ImageDraw
    import io
    try:
        tpl = Image.open(template_img_path).convert("RGBA")
        slot_size = 200
        pad = 16
        card_w = (slot_size + pad) * 4 + pad
        card_h = slot_size + 44
        
        strip = Image.new("RGB", (card_w, card_h), (255, 255, 255))
        draw = ImageDraw.Draw(strip)
        
        orientations = [
            (0, "0° (Upright)"),
            (Image.Transpose.ROTATE_270, "90° (Wall Right)"),
            (Image.Transpose.ROTATE_180, "180° (Inverted)"),
            (Image.Transpose.ROTATE_90, "270° (Wall Left)")
        ]
        
        for idx, (trans, label) in enumerate(orientations):
            x_offset = pad + idx * (slot_size + pad)
            img_rot = tpl if trans == 0 else tpl.transpose(trans)
            # High-resolution rendering to preserve small alphanumeric markers ('3', '2', 'USB')
            img_rot.thumbnail((slot_size - 20, slot_size - 20), Image.Resampling.LANCZOS)
            ox = x_offset + (slot_size - img_rot.width) // 2
            oy = pad + (slot_size - 20 - img_rot.height) // 2
            strip.paste(img_rot, (ox, oy), mask=img_rot if img_rot.mode == "RGBA" else None)
            draw.rectangle([x_offset, pad, x_offset + slot_size, pad + slot_size], outline=(210, 215, 225), width=2)
            draw.text((x_offset + 14, pad + slot_size + 10), label, fill=(30, 41, 59))
            
        buffered = io.BytesIO()
        strip.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode("utf-8")
    except Exception as e:
        print(f"[MultiAngle Template Strip Error] {e}")
        return encode_image_to_base64(template_img_path)

def _record_cost(model_name: str, resp) -> None:
    try:
        from app.services import cost_ledger
        if getattr(resp, "usage", None) is not None:
            cost_ledger.record(model_name, resp.usage)
    except Exception as e:  # never let bookkeeping break a check
        print(f"[cost_ledger] {e}")


def create_vision_chat_completion(client: OpenAI, messages: list, **kwargs):
    """
    Executes completion using OpenAI's premier vision model (gpt-4o for maximum optical acuity on CAD drawings),
    with seamless fallback to gpt-4o-mini and gpt-5-mini.
    Ensures 'temperature' is stripped so models requiring default temperature never throw HTTP 400.
    """
    candidate_models = ["gpt-4o", "gpt-4o-mini", "gpt-5-mini"]
    last_err = None
    for model_name in candidate_models:
        call_kwargs = dict(kwargs)
        # Always omit temperature to ensure universal compatibility across gpt-4o, gpt-5-mini, and o-series
        call_kwargs.pop("temperature", None)

        try:
            resp = client.chat.completions.create(
                model=model_name,
                messages=messages,
                **call_kwargs
            )
            _record_cost(model_name, resp)
            return resp, model_name
        except Exception as e:
            err_msg = str(e).lower()
            # If rejected due to temperature parameter constraint, ensure it's removed and retry once
            if "temperature" in err_msg:
                try:
                    call_kwargs.pop("temperature", None)
                    resp = client.chat.completions.create(
                        model=model_name,
                        messages=messages,
                        **call_kwargs
                    )
                    _record_cost(model_name, resp)
                    return resp, model_name
                except Exception as retry_err:
                    err_msg = str(retry_err).lower()

            # Fallback to next candidate model if model is unavailable, inaccessible, or incompatible
            if any(phrase in err_msg for phrase in ["not found", "does not exist", "access", "permission", "unsupported", "invalid_request"]):
                print(f"[OpenAIService] {model_name} issue ({err_msg[:60]}...), trying fallback candidate...")
                last_err = e
                continue
            raise e
    raise last_err

class OpenAIService:
    @staticmethod
    def get_client(api_key: Optional[str] = None) -> OpenAI:
        key = api_key or settings.openai_api_key or os.getenv("OPENAI_API_KEY", "")
        if not key:
            raise ValueError("OpenAI API key not provided. Please provide an API key in settings or pass it in the request.")
        return OpenAI(api_key=key)

    @staticmethod
    def analyze_legend_box(image_path: str | Path, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Scans an image of an electrical legend and extracts symbol labels, categories, and fix stages.
        """
        client = OpenAIService.get_client(api_key)
        b64 = encode_image_to_base64(image_path)
        
        prompt = """
        You are an expert UK electrical estimator specializing in BS 7671 and IEC drawings for housing developers like Curo and Jeffway Construction.
        Analyze this blueprint legend crop. Identify each electrical symbol listed.
        For each symbol, return a JSON array of objects with:
        - "label": Clear title (e.g. "13A Switched Double Socket", "Pendant Light Fitting", "Ceiling Mounted Smoke Detector")
        - "fix_stage": "1st Fix" (cables, back boxes, containment) or "2nd Fix" (accessories, faceplates, fittings, detectors)
        - "manufacturer": Default to "Deta" for wiring accessories, or standard if specialist
        - "suggested_color": Hex color code for UI canvas pin (e.g. "#EF4444", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6")
        
        Return ONLY a JSON array, no markdown fences or other text.
        """

        response, _ = create_vision_chat_completion(
            client=client,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"},
                        },
                    ],
                }
            ],
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content
        data = json.loads(content)
        # Handle wrapping if returned as {"symbols": [...]}
        if isinstance(data, dict):
            for k in ["symbols", "legend", "items", "results"]:
                if k in data and isinstance(data[k], list):
                    return data[k]
        return data if isinstance(data, list) else []

    @staticmethod
    def detect_room_zones(image_path: str | Path, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Uses GPT-4o Vision to identify the architectural rooms on a floor plan image and their
        approximate bounding boxes (relative percentages 0-100).
        """
        client = OpenAIService.get_client(api_key)
        b64 = encode_image_to_base64(image_path)

        prompt = """
        Analyze this architectural floor plan image. Identify the major rooms and spaces (e.g. Living Room, Kitchen, Dining, Hall, WC, Bathroom, Ensuite, Bedroom 1, Bedroom 2, Bedroom 3, Landing).
        For each room, provide:
        - "name": Room name
        - "box": [min_x_pct, min_y_pct, max_x_pct, max_y_pct] (coordinates as percentages from 0 to 100 of total image width and height).
        
        Return as a JSON object: {"rooms": [{"name": "Living Room", "box": [15, 20, 45, 60]}, ...]}
        """

        response, _ = create_vision_chat_completion(
            client=client,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"},
                        },
                    ],
                }
            ],
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content
        data = json.loads(content)
        return data.get("rooms", [])

    @staticmethod
    def verify_marker_patches(
        template_img_path: str | Path,
        candidate_patches: List[Dict[str, Any]], # [{"marker_id": "...", "patch_b64": "..."}]
        legend_label: str,
        other_legends: Optional[List[str]] = None,
        api_key: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Stage 2 AI Vision Verifier: Evaluates candidate crops against the reference template using
        GPT-4o Vision in high-detail mode with contrastive twin-symbol disambiguation.
        Distinguishes between base glyphs and sub-variants (e.g. Plain Double Socket vs USB Double Socket).
        Utilizes 4-angle rotation ground truth and pre-rotation normalization for rotation invariance.
        """
        client = OpenAIService.get_client(api_key)
        template_raw_b64 = encode_image_to_base64(template_img_path)
        template_strip_b64 = generate_multi_orientation_template_b64(template_img_path)

        # Detect potential modifier keywords in the target legend
        label_lower = legend_label.lower()
        has_usb = "usb" in label_lower
        has_emergency = "emergency" in label_lower or "em" in label_lower
        has_wp = "weatherproof" in label_lower or "wp" in label_lower
        has_fused = "fused" in label_lower or "fcu" in label_lower

        special_rules = []
        if has_usb:
            special_rules.append(
                "CRITICAL 'USB' RULE: The target symbol MUST have the superscript/adjacent 'USB' text label clearly visible. "
                "The drawing contains plain switched double sockets without USB. If the candidate contains the double socket but lacks the 'USB' text, "
                "it is a FALSE MATCH for this symbol: set 'is_valid': false, and set 'suggested_reclassification': '13A switched double socket at low level'."
            )
        if has_emergency:
            special_rules.append(
                "CRITICAL 'EMERGENCY' RULE: The target symbol must have the emergency lighting indicator ('E', arrow, or filled quadrant). "
                "Standard luminaires without the emergency marking must be marked 'is_valid': false."
            )
        if has_wp:
            special_rules.append(
                "CRITICAL 'WEATHERPROOF' RULE: The target symbol must have the WP/weatherproof enclosure annotation."
            )

        # Strict Switch Disambiguation Rules for Gangs & Ways
        if "switch" in label_lower:
            if any(term in label_lower for term in ["3 way", "3-way", "intermediate"]):
                special_rules.append(
                    "CRITICAL 'INTERMEDIATE / 3-WAY SWITCH' RULE: The target symbol is an INTERMEDIATE (3-way) switch. "
                    "In UK drawings, an intermediate switch MUST have the distinct numeral '3' (or intermediate cross/hash mark) clearly visible adjacent to the switch head. "
                    "The blueprint contains standard 1-way switches (no number) and 2-way switches (marked with '2'). "
                    "If the candidate is a plain switch WITHOUT the digit '3', or shows the digit '2', it is 100% a FALSE MATCH: "
                    "set 'is_valid': false, 'confidence': 0.99, and 'reason': 'False match: Plain or 2-way switch lacking required intermediate numeral 3'. "
                    "STRICT PROHIBITION: DO NOT MISTAKE architectural wall linework, door swings, dimension lines, or dashed circuit wires for the numeral '3'!"
                )
            elif any(term in label_lower for term in ["2 way", "2-way"]):
                special_rules.append(
                    "CRITICAL '2-WAY SWITCH' RULE: The target symbol is a 2-WAY switch and MUST feature the numeral '2'. "
                    "Plain switches (no number) or intermediate switches (with '3') are FALSE MATCHES: set 'is_valid': false."
                )
            elif any(term in label_lower for term in ["1 way", "1-way"]):
                special_rules.append(
                    "CRITICAL '1-WAY SWITCH' RULE: The target symbol is a standard 1-WAY switch and has NO numeral attached. "
                    "If the crop contains a '2' or '3', set 'is_valid': false."
                )

            if any(term in label_lower for term in ["2 gang", "2-gang", "twin"]):
                special_rules.append(
                    "CRITICAL '2-GANG' GANG COUNT RULE: The target symbol has TWO switch circles/heads. "
                    "If the candidate shows only a single circle (1-gang), set 'is_valid': false."
                )
            elif any(term in label_lower for term in ["1 gang", "1-gang"]):
                special_rules.append(
                    "CRITICAL '1-GANG' GANG COUNT RULE: The target symbol has only ONE single switch circle/head. "
                    "If the candidate shows two switch circles (2-gang), set 'is_valid': false."
                )

        rules_extra = ""
        if special_rules:
            rules_extra = "\n" + "\n".join(special_rules) + "\n"

        other_legends_text = ""
        if other_legends and len(other_legends) > 0:
            other_legends_text = f"Other electrical symbols defined in this project include: {json.dumps(other_legends)}.\n"

        all_results: List[Dict[str, Any]] = []
        batch_size = 8 # Balanced batch size for high-detail vision inspection

        for b_start in range(0, len(candidate_patches), batch_size):
            batch = candidate_patches[b_start : b_start + batch_size]

            system_instruction = (
                f"You are a strict, senior UK architectural and electrical blueprint takeoff auditor.\n"
                f"Your task is to inspect candidate crops detected on the blueprint and verify if they match the TARGET SYMBOL: '{legend_label}'.\n\n"
                f"REFERENCE IMAGES PROVIDED:\n"
                f"  - IMAGE 1: Master Pristine Legend Template (original uncompressed crop showing exact symbol geometry and any numerals/text).\n"
                f"  - IMAGE 2: 4-Angle Blueprint Wall Rotation Reference (showing 0° Upright, 90° Wall Right, 180° Inverted, 270° Wall Left).\n\n"
                f"CRITICAL RULES FOR VERIFICATION:\n"
                f"1. ROTATION INVARIANCE: Electrical blueprint symbols are 100% ROTATION-INVARIANT.\n"
                f"   - UK architectural drawings place symbols directly along walls. Symbols rotated by 90°, 180°, or 270° (e.g. vertical on a wall) are the EXACT SAME SYMBOL as the upright template.\n"
                f"   - YOU ARE STRICTLY PROHIBITED FROM REJECTING A CANDIDATE DUE TO ORIENTATION OR TILT. If the internal geometry matches the reference at ANY orthogonal angle, it IS A VALID MATCH (is_valid: true).\n\n"
                f"2. CAD LINEWORK & BACKGROUND OVERLAP TOLERANCE:\n"
                f"   - Blueprint electrical symbols are overlaid directly onto architectural floor plans.\n"
                f"   - IGNORE background architectural lines and wall hatching. Focus solely on the electrical symbol glyph itself.\n\n"
                f"3. REJECT UNRELATED GRAPHICS & DIFFERENT SYMBOLS:\n"
                f"   - Reject if the crop is purely architectural text, blank background, or bare walls with NO electrical symbol.\n"
                f"   - Reject if the symbol is clearly a DIFFERENT electrical device or different variant.\n"
                f"{rules_extra}\n"
                f"Return valid JSON in this exact structure:\n"
                f"{{\n"
                f'  "verifications": [\n'
                f'    {{\n'
                f'      "candidate_index": 1,\n'
                f'      "is_valid": true,\n'
                f'      "confidence": 0.98,\n'
                f'      "reason": "Clear explanation: e.g. Valid 3-way intermediate switch with clear numeral 3 mounted on wall"\n'
                f'    }}\n'
                f'  ]\n'
                f"}}"
            )

            user_content: List[Dict[str, Any]] = [
                {
                    "type": "text",
                    "text": system_instruction
                },
                {
                    "type": "text",
                    "text": "IMAGE 1: Master Pristine Legend Template:"
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{template_raw_b64}", "detail": "high"}
                },
                {
                    "type": "text",
                    "text": "IMAGE 2: 4-Angle Blueprint Wall Rotation Reference Guide (0°, 90°, 180°, 270°):"
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{template_strip_b64}", "detail": "high"}
                }
            ]

            for idx, cand in enumerate(batch, 1):
                ang = cand.get("angle")
                ang_str = f" [Wall Alignment: {ang}°]" if ang is not None else ""
                user_content.append({
                    "type": "text",
                    "text": f"Candidate #{idx} (Marker ID: {cand['marker_id']}{ang_str}):"
                })
                user_content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{cand['patch_b64']}", "detail": "high"}
                })

            response, model_used = create_vision_chat_completion(
                client=client,
                messages=[{"role": "user", "content": user_content}],
                response_format={"type": "json_object"},
            )

            content = response.choices[0].message.content or "{}"
            data = json.loads(content)
            verifications = data.get("verifications", [])

            batch_results: List[Dict[str, Any]] = []
            for v in verifications:
                c_idx = v.get("candidate_index", 1) - 1
                if 0 <= c_idx < len(batch):
                    m_id = batch[c_idx]["marker_id"]
                    res_item = {
                        "marker_id": m_id,
                        "is_valid": bool(v.get("is_valid", False)),
                        "confidence": float(v.get("confidence", 0.90)),
                        "reason": str(v.get("reason", "Verified by AI")),
                    }
                    if v.get("suggested_reclassification"):
                        res_item["suggested_reclassification"] = str(v["suggested_reclassification"])
                    all_results.append(res_item)
                    batch_results.append(res_item)

            # Record log for transparent inspector portal
            try:
                from app.services.audit_logger import record_audit_log
                from app.services import cost_ledger
                record_audit_log(
                    legend_label=legend_label,
                    template_b64=template_raw_b64,
                    template_strip_b64=template_strip_b64,
                    candidates=[
                        {
                            "marker_id": c["marker_id"],
                            "patch_b64": c["patch_b64"],
                            "index": i + 1,
                            "angle": c.get("angle"),
                            "confidence_score": c.get("confidence_score"),
                            "page_index": c.get("page_index"),
                        }
                        for i, c in enumerate(batch)
                    ],
                    prompt_text=system_instruction,
                    raw_response=content,
                    verifications=batch_results,
                    model_used=model_used,
                    usage=cost_ledger.price(model_used, getattr(response, "usage", None)),
                    tag=cost_ledger.current_tag(),
                )
            except Exception as log_err:
                print(f"[AuditLogger Error] {log_err}")

        return all_results
