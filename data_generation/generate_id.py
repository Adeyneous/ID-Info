"""
Phase 0a: Minimum viable ID generator.
Generates a single synthetic AAMVA-structured ID image to verify the toolchain.
"""

from PIL import Image, ImageDraw, ImageFont
from faker import Faker
import random

# Card dimensions at ~300 DPI for a 3.375" x 2.125" license
CARD_W, CARD_H = 1012, 638

# Font paths relative to where we run the script from (project root)
FONT_REGULAR = "data_generation/fonts/DejaVuSans.ttf"
FONT_BOLD = "data_generation/fonts/DejaVuSans-Bold.ttf"

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
    first = fake.first_name().upper()
    last = fake.last_name().upper()
    middle = fake.first_name().upper()
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
        "DBC": random.choice(["M", "F"]),
        "DAU": random_height(),
        "DAW": random_weight(),
        "DAY": random_eyes(),
        "DCA": random.choice(["C", "D", "M"]),
    }


def draw_field(draw, label, value, x, y, label_font, value_font):
    """Draw a small AAMVA code label and the value below it."""
    draw.text((x, y), label, font=label_font, fill=(80, 80, 80))
    label_h = label_font.getbbox(label)[3]
    value_y = y + label_h + 2
    draw.text((x, value_y), value, font=value_font, fill=(20, 20, 20))


def generate_id(output_path):
    img = Image.new("RGB", (CARD_W, CARD_H), (245, 243, 235))
    draw = ImageDraw.Draw(img)

    label_font = ImageFont.truetype(FONT_REGULAR, 14)
    value_font = ImageFont.truetype(FONT_BOLD, 22)
    title_font = ImageFont.truetype(FONT_BOLD, 32)
    state_font = ImageFont.truetype(FONT_BOLD, 26)

    # Header strip
    draw.rectangle([(0, 0), (CARD_W, 70)], fill=(50, 80, 130))
    draw.text((30, 18), "GENERIC STATE", font=state_font, fill=(255, 255, 255))
    draw.text((CARD_W - 360, 22), "DRIVER LICENSE", font=title_font, fill=(255, 255, 255))

    # Photo placeholder
    draw.rectangle([(30, 100), (270, 400)], fill=(200, 200, 200), outline=(120, 120, 120), width=2)
    draw.text((110, 240), "PHOTO", font=value_font, fill=(120, 120, 120))

    record = generate_record()

    # Right column of fields
    x_right = 300
    y = 100
    draw_field(draw, "1 DAA", record["DAA"] + ",", x_right, y, label_font, value_font)
    y += 60
    draw_field(draw, "2 DAC", f"{record['DAC']} {record['DAD']}", x_right, y, label_font, value_font)
    y += 60
    draw_field(draw, "8 DAG", record["DAG"], x_right, y, label_font, value_font)
    y += 60
    city_state_zip = f"{record['DAI']}, {record['DAJ']} {record['DAK']}"
    draw_field(draw, "  ", city_state_zip, x_right, y, label_font, value_font)
    y += 70

    draw_field(draw, "4 DOB", record["DBB"], x_right, y, label_font, value_font)
    draw_field(draw, "10 ISS", record["DBD"], x_right + 220, y, label_font, value_font)
    draw_field(draw, "4b EXP", record["DBA"], x_right + 440, y, label_font, value_font)

    # Bottom row
    y_bot = 480
    draw_field(draw, "15 SEX", record["DBC"], 30, y_bot, label_font, value_font)
    draw_field(draw, "16 HGT", record["DAU"], 150, y_bot, label_font, value_font)
    draw_field(draw, "17 WGT", record["DAW"], 320, y_bot, label_font, value_font)
    draw_field(draw, "18 EYES", record["DAY"], 470, y_bot, label_font, value_font)
    draw_field(draw, "5 DL CLASS", record["DCA"], 620, y_bot, label_font, value_font)
    draw_field(draw, "4d DL", record["DAQ"], 780, y_bot, label_font, value_font)

    img.save(output_path)
    return record


if __name__ == "__main__":
    record = generate_id("output/sample_001.png")
    print("Generated ID with fields:")
    for code, value in record.items():
        print(f"  {code}: {value}")
    print("\nImage saved to output/sample_001.png")