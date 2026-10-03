"""Build a two-page, fictional PDF: Chinese text layer + scanned image.

Run build-corpus.py first. This fixture stays in the ignored fixtures directory.
Requires pypdf; no AI service or user documents are involved.
"""

from pathlib import Path

from pypdf import PdfReader, PdfWriter


def main() -> None:
    fixture_dir = Path(__file__).resolve().parent / "fixtures"
    source_names = ("product-4.pdf", "scan.pdf")
    output_path = fixture_dir / "mixed-text-scan.pdf"
    for name in source_names:
        if not (fixture_dir / name).is_file():
            raise FileNotFoundError(f"先运行 build-corpus.py：缺少 {name}")

    writer = PdfWriter()
    for name in source_names:
        writer.add_page(PdfReader(fixture_dir / name).pages[0])
    with output_path.open("wb") as output:
        writer.write(output)
    print(output_path)


if __name__ == "__main__":
    main()
