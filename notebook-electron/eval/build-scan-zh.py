"""Create a fictional Chinese image-only PDF for local OCR boundary checks."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


def main() -> None:
    fixture_dir = Path(__file__).resolve().parent / "fixtures"
    fixture_dir.mkdir(exist_ok=True)
    output_path = fixture_dir / "scan-zh.pdf"
    image = Image.new("RGB", (1600, 260), "white")
    font = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", 60)
    ImageDraw.Draw(image).text((40, 60), "星桥X9整机保修期为15个月。", fill="black", font=font)
    pdf = canvas.Canvas(str(output_path))
    pdf.drawImage(ImageReader(image), 30, 600, width=550, height=90)
    pdf.save()
    print(output_path)


if __name__ == "__main__":
    main()
