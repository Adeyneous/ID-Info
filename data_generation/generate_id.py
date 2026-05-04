"""
Phase 0b: ID generator with ground truth JSON output.

Generates a synthetic AAMVA-structured ID image and a paired JSON file
containing every field's text and pixel bounding box.

Run: python data_generation/generate_id.py
Run with debug overlay: python data_generation/generate_id.py --debug
"""

from PIL import Image, ImageDraw, ImageFont
from faker import Faker
import random
import json
import sys
from pathlib import Path

# Card dimensions at ~300 DPI for a 3.375" x 2.125" license
CARD_W, CARD_H = 1012, 638

FONT_REGULAR = "data_generation/fonts/DejaVuSans.ttf"
FONT_BOLD = "data_generation/fonts/DejaVuSans-Bold.ttf"

# Map AAMVA codes to human-readable field names. Used in the JSON output.
FIELD_NAMES = {
    "DAQ": "license_number",
    "DAC": "first_name",
    "DAD": "middle_name",
    "DAA": "last_name",
    "DAG": "street_address",
    "DAI": "city",
    "DAJ": "state",
    "DAK": "zip_code",
    "DBB": "date_of_birth",
    "DBA": "expiration_date",
    "DBD": "issue_date",
    "DBC": "sex",
    "DAU": "height",
    "DAW": "weight",
    "DAY": "eye_color",
    "DCA": "license_class",
}

fake = Faker("en_US")


def random_height():
    feet = random.randint(4, 6)
    inches = random.randint(0, 11)
    return f"{feet}'-{inches:02d}\""


def random_weight():
    return f"{random.randint(100, 280)} lb"


def random_eyes():
    return random.choice(["BRO", "BLU", "GRN", "HAZ", "GRY", "BLK"])


def random_dl_number():
    return random.choice([
        f"{random.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}{random.randint(1000000, 9999999)}",
        f"{random.randint(100000000, 999999999)}",
    ])


def generate_record():
    """Generate one fake person's data following AAMVA field conventions."""
    sex = random.choice(["M", "F"])
    if sex == "M":
        first = fake.first_name_male().upper()
        middle = fake.first_name_male().upper()
    else:
        first = fake.first_name_female().upper()
        middle = fake.first_name_female().upper()
    last = fake.last_name().upper()

    dob = fake.date_of_birth(minimum_age=18, maximum_age=85)
    iss = fake.date_between(start_date="-4y", end_date="today")
    exp_year = iss.year + random.choice([4, 5, 8])
    exp = iss.replace(year=exp_year)

    return {
        "DAQ": random_dl_number(),
        "DAC": first,
        "DAD": middle,
        "DAA": last,
        "DAG": fake.street_address().upper(),
        "DAI": fake.city().upper(),
        "DAJ": fake.state_abbr(),
        "DAK": fake.zipcode(),
        "DBB": dob.strftime("%m/%d/%Y"),
        "DBA": exp.strftime("%m/%d/%Y"),
        "DBD": iss.strftime("%m/%d/%Y"),
        "DBC": sex,
        "DAU": random_height(),
        "DAW": random_weight(),
        "DAY": random_eyes(),
        "DCA": random.choice(["C", "D", "M"]),
    }

def measure_text_bbox(draw, text, x, y, font):
    """
    Compute the pixel bounding box that `text` would occupy if drawn at (x, y)
    with the given font, without actually drawing it.
    Returns (x0, y0, x1, y1).
    """
    return draw.textbbox((x, y), text, font=font)


def draw_field(draw, code, value, x, y, label_font, value_font):
    """
    Draw an AAMVA code label and the value below it.
    Returns the bounding box of the VALUE text (not the label).
    Box format: (x0, y0, x1, y1) in pixel coordinates.
    """
    # Draw the small gray AAMVA code (not part of ground truth)
    draw.text((x, y), code, font=label_font, fill=(80, 80, 80))
    label_h = label_font.getbbox(code)[3]

    # Draw the actual field value
    value_y = y + label_h + 2
    draw.text((x, value_y), value, font=value_font, fill=(20, 20, 20))

    # Capture the precise pixel bounding box of the rendered value
    bbox = draw.textbbox((x, value_y), value, font=value_font)
    return bbox  # (x0, y0, x1, y1)


def generate_id(image_path, json_path, debug=False):
    """
    Generate one ID image and its ground truth JSON.
    If debug=True, also draws colored boxes over each field for verification.
    """
    img = Image.new("RGB", (CARD_W, CARD_H), (245, 243, 235))
    draw = ImageDraw.Draw(img)

    label_font = ImageFont.truetype(FONT_REGULAR, 14)
    value_font = ImageFont.truetype(FONT_BOLD, 22)
    title_font = ImageFont.truetype(FONT_BOLD, 32)
    state_font = ImageFont.truetype(FONT_BOLD, 26)

    # Header
    draw.rectangle([(0, 0), (CARD_W, 70)], fill=(50, 80, 130))
    draw.text((30, 18), "GENERIC STATE", font=state_font, fill=(255, 255, 255))
    draw.text((CARD_W - 360, 22), "DRIVER LICENSE", font=title_font, fill=(255, 255, 255))

    # Photo placeholder
    draw.rectangle([(30, 100), (270, 400)], fill=(200, 200, 200), outline=(120, 120, 120), width=2)
    draw.text((110, 240), "PHOTO", font=value_font, fill=(120, 120, 120))

    record = generate_record()
    bboxes = {}  # AAMVA code -> (x0, y0, x1, y1)

    # Right column
    x_right = 300
    y = 100
   # Last name (with trailing comma — track bbox of just the name without comma)
    bboxes["DAA"] = draw_field(draw, "1 DAA", record["DAA"] + ",", x_right, y, label_font, value_font)
    y += 60

    # First + middle name on one visual line, but with separate bboxes per field
    label_h = label_font.getbbox("2 DAC")[3]
    draw.text((x_right, y), "2 DAC", font=label_font, fill=(80, 80, 80))
    name_y = y + label_h + 2
    # First name
    draw.text((x_right, name_y), record["DAC"], font=value_font, fill=(20, 20, 20))
    bboxes["DAC"] = draw.textbbox((x_right, name_y), record["DAC"], font=value_font)
    # Position middle name right after first name with a space
    space_w = value_font.getbbox(" ")[2]
    middle_x = bboxes["DAC"][2] + space_w
    draw.text((middle_x, name_y), record["DAD"], font=value_font, fill=(20, 20, 20))
    bboxes["DAD"] = draw.textbbox((middle_x, name_y), record["DAD"], font=value_font)
    y += 60

    # Street address — single field, single bbox
    bboxes["DAG"] = draw_field(draw, "8 DAG", record["DAG"], x_right, y, label_font, value_font)
    y += 60

    # City, state, zip — three separate AAMVA fields rendered on one line
    label_h = label_font.getbbox("  ")[3]
    csz_y = y + label_h + 2
    # City (with trailing comma in display, but bbox covers just the city text)
    city_text = record["DAI"]
    draw.text((x_right, csz_y), city_text, font=value_font, fill=(20, 20, 20))
    bboxes["DAI"] = draw.textbbox((x_right, csz_y), city_text, font=value_font)
    # Render the comma after the city
    comma_x = bboxes["DAI"][2]
    draw.text((comma_x, csz_y), ",", font=value_font, fill=(20, 20, 20))
    # State
    state_x = comma_x + value_font.getbbox(", ")[2]
    draw.text((state_x, csz_y), record["DAJ"], font=value_font, fill=(20, 20, 20))
    bboxes["DAJ"] = draw.textbbox((state_x, csz_y), record["DAJ"], font=value_font)
    # Zip
    zip_x = bboxes["DAJ"][2] + space_w
    draw.text((zip_x, csz_y), record["DAK"], font=value_font, fill=(20, 20, 20))
    bboxes["DAK"] = draw.textbbox((zip_x, csz_y), record["DAK"], font=value_font)
    y += 70
    
    bboxes["DBB"] = draw_field(draw, "4 DOB", record["DBB"], x_right, y, label_font, value_font)
    bboxes["DBD"] = draw_field(draw, "10 ISS", record["DBD"], x_right + 220, y, label_font, value_font)
    bboxes["DBA"] = draw_field(draw, "4b EXP", record["DBA"], x_right + 440, y, label_font, value_font)

    # Bottom row
    y_bot = 480
    bboxes["DBC"] = draw_field(draw, "15 SEX", record["DBC"], 30, y_bot, label_font, value_font)
    bboxes["DAU"] = draw_field(draw, "16 HGT", record["DAU"], 150, y_bot, label_font, value_font)
    bboxes["DAW"] = draw_field(draw, "17 WGT", record["DAW"], 320, y_bot, label_font, value_font)
    bboxes["DAY"] = draw_field(draw, "18 EYES", record["DAY"], 470, y_bot, label_font, value_font)
    bboxes["DCA"] = draw_field(draw, "5 DL CLASS", record["DCA"], 620, y_bot, label_font, value_font)
    bboxes["DAQ"] = draw_field(draw, "4d DL", record["DAQ"], 780, y_bot, label_font, value_font)

    # If debug mode is on, draw the bounding boxes on the image so we can verify
    if debug:
        for code, bbox in bboxes.items():
            draw.rectangle(bbox, outline=(255, 0, 0), width=2)

    img.save(image_path)

    # Build the JSON ground truth
    ground_truth = {
        "image_file": Path(image_path).name,
        "image_size": {"width": CARD_W, "height": CARD_H},
        "fields": [],
    }
    for code in record:
        if code in bboxes:
            x0, y0, x1, y1 = bboxes[code]
            ground_truth["fields"].append({
                "code": code,
                "name": FIELD_NAMES.get(code, code),
                "text": record[code],
                "bbox": {
                    "x0": int(x0),
                    "y0": int(y0),
                    "x1": int(x1),
                    "y1": int(y1),
                },
            })

    with open(json_path, "w") as f:
        json.dump(ground_truth, f, indent=2)

    return record, bboxes


if __name__ == "__main__":
    debug_mode = "--debug" in sys.argv

    image_path = "output/sample_001.png"
    json_path = "output/sample_001.json"

    record, bboxes = generate_id(image_path, json_path, debug=debug_mode)

    print(f"Image saved to {image_path}")
    print(f"Ground truth saved to {json_path}")
    if debug_mode:
        print("(Debug mode: bounding boxes drawn in red on image)")
    print()
    print("Generated fields:")
    for code, value in record.items():
        x0, y0, x1, y1 = bboxes[code]
        print(f"  {code} ({FIELD_NAMES[code]}): '{value}'  bbox=({x0}, {y0}, {x1}, {y1})")