#!/usr/bin/env python3
"""Build CCC's private, gated Credit Report Field Guide PDF."""

from __future__ import annotations

import os
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "netlify/functions/assets/credit-comeback-club-credit-report-field-guide.pdf"
LOGO = ROOT / "public/logo.jpg"

PAGE_W, PAGE_H = letter
NAVY = colors.HexColor("#0B1F3A")
INK = colors.HexColor("#111827")
SKY = colors.HexColor("#2B8FD4")
SKY_DARK = colors.HexColor("#2176B2")
PALE = colors.HexColor("#EAF5FC")
PALE_2 = colors.HexColor("#F5FAFE")
MID = colors.HexColor("#B8DDEF")
GRAY = colors.HexColor("#5C6878")
LIGHT_GRAY = colors.HexColor("#D8E2EC")
WHITE = colors.white
GOLD = colors.HexColor("#F0B429")
GREEN = colors.HexColor("#14845C")
RED = colors.HexColor("#B54747")


def register_fonts() -> tuple[str, str, str]:
    """Use bundled system fonts when available, with built-in fallbacks."""
    candidates = [
        ("/System/Library/Fonts/Supplemental/Arial.ttf", "Arial"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "DejaVu"),
    ]
    bold_candidates = [
        ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "Arial-Bold"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVu-Bold"),
    ]
    italic_candidates = [
        ("/System/Library/Fonts/Supplemental/Arial Italic.ttf", "Arial-Italic"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf", "DejaVu-Oblique"),
    ]

    def first(items: list[tuple[str, str]], fallback: str) -> str:
        for path, name in items:
            if Path(path).exists():
                pdfmetrics.registerFont(TTFont(name, path))
                return name
        return fallback

    return (
        first(candidates, "Helvetica"),
        first(bold_candidates, "Helvetica-Bold"),
        first(italic_candidates, "Helvetica-Oblique"),
    )


FONT, FONT_BOLD, FONT_ITALIC = register_fonts()


class NumberedDocTemplate(BaseDocTemplate):
    pass


def page_chrome(canvas, doc):
    page = canvas.getPageNumber()
    canvas.saveState()
    if page == 1:
        canvas.setFillColor(NAVY)
        canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        canvas.setFillColor(SKY)
        canvas.circle(PAGE_W + 12, PAGE_H - 20, 170, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#102A4D"))
        canvas.circle(-45, 40, 145, fill=1, stroke=0)
    else:
        canvas.setFillColor(PALE_2)
        canvas.rect(0, PAGE_H - 38, PAGE_W, 38, fill=1, stroke=0)
        canvas.setFillColor(SKY)
        canvas.rect(0, PAGE_H - 4, PAGE_W, 4, fill=1, stroke=0)
        canvas.setFont(FONT_BOLD, 8.2)
        canvas.setFillColor(NAVY)
        canvas.drawString(46, PAGE_H - 25, "CREDIT COMEBACK CLUB")
        canvas.setFont(FONT, 7.8)
        canvas.setFillColor(GRAY)
        canvas.drawRightString(PAGE_W - 46, PAGE_H - 25, "CREDIT REPORT FIELD GUIDE")
        canvas.setStrokeColor(LIGHT_GRAY)
        canvas.line(46, 34, PAGE_W - 46, 34)
        canvas.setFont(FONT, 7.5)
        canvas.setFillColor(GRAY)
        canvas.drawString(46, 20, "Educational information - not legal advice")
        canvas.setFont(FONT_BOLD, 8)
        canvas.drawRightString(PAGE_W - 46, 20, str(page))
    canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    "CoverKicker", fontName=FONT_BOLD, fontSize=10, leading=12, textColor=MID,
    spaceAfter=16, uppercase=True, tracking=1.5,
))
styles.add(ParagraphStyle(
    "CoverTitle", fontName=FONT_BOLD, fontSize=34, leading=37, textColor=WHITE,
    spaceAfter=18,
))
styles.add(ParagraphStyle(
    "CoverSub", fontName=FONT, fontSize=13.5, leading=19, textColor=colors.HexColor("#D7E8F5"),
    spaceAfter=22,
))
styles.add(ParagraphStyle(
    "SectionNo", fontName=FONT_BOLD, fontSize=9, leading=11, textColor=SKY,
    tracking=1.2, spaceAfter=7,
))
styles.add(ParagraphStyle(
    "H1", fontName=FONT_BOLD, fontSize=23, leading=27, textColor=NAVY,
    spaceAfter=10,
))
styles.add(ParagraphStyle(
    "Dek", fontName=FONT, fontSize=10.5, leading=15, textColor=GRAY,
    spaceAfter=15,
))
styles.add(ParagraphStyle(
    "H2", fontName=FONT_BOLD, fontSize=13.2, leading=16, textColor=NAVY,
    spaceBefore=10, spaceAfter=6,
))
styles.add(ParagraphStyle(
    "Body", fontName=FONT, fontSize=9.4, leading=13.4, textColor=INK,
    spaceAfter=7,
))
styles.add(ParagraphStyle(
    "Small", fontName=FONT, fontSize=8.2, leading=11.2, textColor=GRAY,
    spaceAfter=5,
))
styles.add(ParagraphStyle(
    "Tiny", fontName=FONT, fontSize=7.2, leading=9.2, textColor=GRAY,
))
styles.add(ParagraphStyle(
    "CCCBullet", fontName=FONT, fontSize=9.2, leading=13, textColor=INK,
    leftIndent=14, firstLineIndent=-9, bulletIndent=0, spaceAfter=4,
))
styles.add(ParagraphStyle(
    "Check", fontName=FONT, fontSize=9, leading=12.4, textColor=INK,
    spaceAfter=0,
))
styles.add(ParagraphStyle(
    "Callout", fontName=FONT, fontSize=9.1, leading=13.2, textColor=NAVY,
))
styles.add(ParagraphStyle(
    "TableHead", fontName=FONT_BOLD, fontSize=7.8, leading=9.6, textColor=WHITE,
))
styles.add(ParagraphStyle(
    "TableCell", fontName=FONT, fontSize=7.4, leading=9.3, textColor=INK,
))
styles.add(ParagraphStyle(
    "TableCellSmall", fontName=FONT, fontSize=6.6, leading=8.2, textColor=INK,
))
styles.add(ParagraphStyle(
    "Worksheet", fontName=FONT, fontSize=8, leading=10.5, textColor=GRAY,
))
styles.add(ParagraphStyle(
    "Quote", fontName=FONT_ITALIC, fontSize=9.4, leading=14, textColor=NAVY,
))
styles.add(ParagraphStyle(
    "ProofQuote", fontName=FONT_ITALIC, fontSize=10.2, leading=15, textColor=INK,
    spaceAfter=8,
))
styles.add(ParagraphStyle(
    "ProofName", fontName=FONT_BOLD, fontSize=9.2, leading=12, textColor=NAVY,
))
styles.add(ParagraphStyle(
    "ProofContext", fontName=FONT, fontSize=7.8, leading=10, textColor=SKY_DARK,
))
styles.add(ParagraphStyle(
    "CTAHeadline", fontName=FONT_BOLD, fontSize=28, leading=32, textColor=WHITE,
    alignment=TA_CENTER, spaceAfter=13,
))
styles.add(ParagraphStyle(
    "CTABody", fontName=FONT, fontSize=11, leading=16.5, textColor=colors.HexColor("#D7E8F5"),
    alignment=TA_CENTER, spaceAfter=10,
))
styles.add(ParagraphStyle(
    "CTAButton", fontName=FONT_BOLD, fontSize=12, leading=15, textColor=WHITE,
    alignment=TA_CENTER,
))


def p(text: str, style: str = "Body") -> Paragraph:
    return Paragraph(text, styles[style])


def page_title(number: str, title: str, dek: str) -> list:
    return [p(number, "SectionNo"), p(title, "H1"), p(dek, "Dek")]


def bullet(text: str) -> Paragraph:
    return Paragraph(f"<bullet>&bull;</bullet>{text}", styles["CCCBullet"])


class EmptyCheckbox(Flowable):
    """Small vector checkbox that prints cleanly with any font."""

    def __init__(self):
        super().__init__()
        self.width = 10
        self.height = 12

    def draw(self):
        self.canv.setStrokeColor(NAVY)
        self.canv.setLineWidth(0.8)
        self.canv.rect(0.5, 2.5, 7.5, 7.5, fill=0, stroke=1)


def check(text: str) -> Table:
    row = Table(
        [[EmptyCheckbox(), Paragraph(text, styles["Check"])]],
        colWidths=[16, PAGE_W - 92 - 16],
        hAlign="LEFT",
    )
    row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return row


def rule_spacer(height=8):
    return Table([[""]], colWidths=[PAGE_W - 92], rowHeights=[height], style=TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, LIGHT_GRAY),
    ]))


def callout(title: str, text: str, color=SKY, fill=PALE):
    data = [[Paragraph(title.upper(), ParagraphStyle(
        "CallTitleDynamic", parent=styles["Small"], fontName=FONT_BOLD,
        fontSize=7.8, leading=9, textColor=color, tracking=0.7, spaceAfter=3,
    )), p(text, "Callout")]]
    box = Table(data, colWidths=[102, PAGE_W - 92 - 102 - 24], hAlign="LEFT")
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.7, MID),
        ("LINEBEFORE", (0, 0), (0, -1), 4, color),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return box


def proof_card(quote: str, name: str, context: str) -> Table:
    """Branded, text-first proof card using already-published CCC testimonials."""
    card = Table(
        [[[
            Paragraph("CLIENT EXPERIENCE", ParagraphStyle(
                "ProofLabelDynamic", parent=styles["Small"], fontName=FONT_BOLD,
                fontSize=7.8, leading=10, textColor=SKY_DARK, tracking=0.8,
                spaceAfter=6,
            )),
            Paragraph(f"“{quote}”", styles["ProofQuote"]),
            Paragraph(name, styles["ProofName"]),
            Paragraph(context, styles["ProofContext"]),
        ]]],
        colWidths=[PAGE_W - 92],
        hAlign="LEFT",
    )
    card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("BOX", (0, 0), (-1, -1), 0.8, MID),
        ("LINEBEFORE", (0, 0), (0, -1), 5, SKY),
        ("LEFTPADDING", (0, 0), (-1, -1), 16),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ("TOPPADDING", (0, 0), (-1, -1), 13),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 13),
    ]))
    return card


def consultation_button() -> Table:
    href = "https://pulse.scorexer.com/Portal/meeting.jsp?id=5d235976-7de9-49d9-a061-dab6275c3c99"
    label = Paragraph(
        f'<link href="{href}" color="#FFFFFF"><b>Schedule a no-pressure consultation  →</b></link>',
        styles["CTAButton"],
    )
    button = Table([[label]], colWidths=[320], rowHeights=[48], hAlign="CENTER")
    button.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SKY),
        ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#75BCEA")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 16),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return button


def data_table(headers, rows, widths, font_style="TableCell", row_heights=None):
    converted = [[p(str(cell), "TableHead") for cell in headers]]
    converted += [[p(str(cell), font_style) for cell in row] for row in rows]
    table = Table(converted, colWidths=widths, repeatRows=1, rowHeights=row_heights, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_2]),
        ("BOX", (0, 0), (-1, -1), 0.7, LIGHT_GRAY),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, LIGHT_GRAY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def worksheet_lines(labels, line_height=25):
    rows = []
    for label in labels:
        rows.append([p(f"<b>{label}</b>", "Worksheet"), ""])
    table = Table(rows, colWidths=[130, PAGE_W - 92 - 130], rowHeights=[line_height] * len(rows), hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("LINEBELOW", (1, 0), (1, -1), 0.6, GRAY),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return table


def blank_grid(headers, widths, row_count=6, row_height=30):
    rows = [["" for _ in headers] for _ in range(row_count)]
    return data_table(headers, rows, widths, row_heights=[None] + [row_height] * row_count)


def add_page(story, number, title, dek, content):
    story.extend(page_title(number, title, dek))
    story.extend(content)
    story.append(PageBreak())


def build_story():
    story = []

    # 1 - cover
    story.append(Spacer(1, 52))
    if LOGO.exists():
        logo = Image(str(LOGO), width=1.05 * inch, height=1.05 * inch, kind="proportional")
        logo.hAlign = "LEFT"
        story.append(logo)
        story.append(Spacer(1, 24))
    story.append(p("THE DIY ACCURACY WORKBOOK", "CoverKicker"))
    story.append(p("The Credit Report<br/>Field Guide", "CoverTitle"))
    story.append(p(
        "A practical system for obtaining all three reports, separating source facts from assumptions, documenting evidence, writing clear factual correspondence, and tracking what happens next.",
        "CoverSub",
    ))
    story.append(Spacer(1, 16))
    cover_box = Table([[
        p("READ", "TableHead"), p("DOCUMENT", "TableHead"), p("WRITE", "TableHead"), p("TRACK", "TableHead"),
    ]], colWidths=[113, 113, 113, 113], rowHeights=[34])
    cover_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SKY),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#75BCEA")),
        ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#75BCEA")),
    ]))
    story.append(cover_box)
    story.append(Spacer(1, 80))
    story.append(Paragraph(
        "Credit Comeback Club, LLC<br/><font size='8'>2026 EDITION &nbsp; | &nbsp; EDUCATIONAL INFORMATION - NOT LEGAL ADVICE</font>",
        ParagraphStyle("CoverFooter", fontName=FONT_BOLD, fontSize=12, leading=17, textColor=WHITE),
    ))
    story.append(PageBreak())

    # 2 - use guide
    add_page(story, "START HERE", "How to use this guide", "Work in order, preserve the original record, and make every statement traceable to something you can show.", [
        callout("Core rule", "A difference is a <b>review flag</b>, not automatic proof of an error. Your job is to identify the exact field, find reliable support, and describe only what the documents establish."),
        p("A disciplined four-part loop", "H2"),
        data_table(
            ["1. READ", "2. DOCUMENT", "3. WRITE", "4. TRACK"],
            [["Obtain fresh reports and read each bureau separately.", "Save source pages and supporting records without altering them.", "State the exact item, the exact issue, and the correction or investigation requested.", "Log delivery, responses, report changes, and the evidence behind your next decision."]],
            [113, 113, 113, 113],
        ),
        p("Your working folder", "H2"),
        check("One folder for the current three-bureau report set, labeled with the date obtained."),
        check("One account folder per creditor or collector, using only the last four digits in filenames."),
        check("A correspondence folder with sent copies, enclosures, delivery records, and replies."),
        check("A master log so you do not rely on memory."),
        callout("Privacy", "Do not place full Social Security numbers, full account numbers, passwords, or unnecessary medical or financial details in worksheets, filenames, or email subject lines.", color=RED, fill=colors.HexColor("#FFF5F5")),
        p("This guide is educational and general. It does not determine whether your information is inaccurate, give legal advice, replace official instructions, or promise a result. Laws, policies, report formats, and deadlines can change; verify the current rule that applies to your facts.", "Small"),
    ])

    # 3 - roadmap
    add_page(story, "ROADMAP", "Your end-to-end review path", "Use this map to know what “done” looks like at each stage before moving forward.", [
        data_table(
            ["STAGE", "OUTPUT", "READY WHEN..."],
            [
                ["1. Obtain", "Three dated report files", "You can identify source, date, and owner for each report."],
                ["2. Inventory", "One row per reporting item", "Every item has a bureau, partial account ID, and page reference."],
                ["3. Compare", "Field-by-field differences", "You separated a difference from a supported inaccuracy."],
                ["4. Evidence", "Source-backed issue file", "Each claim traces to a report page and reliable supporting record."],
                ["5. Correspond", "A focused factual letter", "The recipient can identify the item, issue, support, and request."],
                ["6. Send", "Complete mailing record", "You retained exactly what was sent and proof of its date/method."],
                ["7. Analyze", "Response worksheet", "You compared the response and fresh report to your original issue."],
                ["8. Decide", "Written next-step rationale", "Your choice follows the evidence, not frustration or guesswork."],
            ],
            [70, 145, 237],
        ),
        p("Stop signs", "H2"),
        bullet("You cannot identify which exact account or field you mean."),
        bullet("Your support is an assumption, an online claim, or a recollection you cannot verify."),
        bullet("You are tempted to change a date, copy someone else's story, or dispute accurate information."),
        bullet("The issue involves identity theft, a lawsuit, a court order, a deceased person, mixed identity, active bankruptcy, or another situation that may need specialized guidance."),
        callout("Decision habit", "At every stage, write one sentence answering: <b>What do I know, how do I know it, and what remains unknown?</b>"),
    ])

    # 4 - obtain reports
    add_page(story, "STEP 1", "Obtain and preserve all three reports", "A complete review starts with current, identifiable source documents - not screenshots stripped of context.", [
        p("Capture the source context", "H2"),
        check("Obtain a report from each nationwide consumer reporting company using an official or otherwise reliable source available to you."),
        check("Save or print the complete report, including headers, legends, disclosures, and page numbers."),
        check("Record the date obtained and the date the report says it was generated or updated."),
        check("Confirm the file belongs to you before storing or reviewing it."),
        p("Name files consistently", "H2"),
        callout("Example", "<b>2026-08-22_Equifax_full-report.pdf</b><br/><b>2026-08-22_Experian_full-report.pdf</b><br/><b>2026-08-22_TransUnion_full-report.pdf</b>"),
        p("Preserve before annotating", "H2"),
        bullet("Keep one untouched original. Work from a copy if you highlight or add notes."),
        bullet("Do not crop away bureau name, report date, page number, section label, or account identifier."),
        bullet("If viewing online, save the complete accessible file when possible; a single-screen screenshot may omit context."),
        bullet("Store the files in a secure location with device and account protections appropriate for sensitive personal information."),
        callout("If a report is unavailable", "Write down the date, source, exact error message, and steps attempted. Do not invent missing fields or substitute another bureau's data."),
    ])

    # 5 source registry worksheet
    add_page(story, "WORKSHEET 1", "Three-report source registry", "Complete this before reviewing accounts. It creates a clean chain back to the original report set.", [
        blank_grid(
            ["BUREAU / SOURCE", "DATE OBTAINED", "REPORT DATE", "FILE NAME / LOCATION", "COMPLETE?"],
            [88, 70, 70, 170, 54], row_count=5, row_height=42,
        ),
        Spacer(1, 14),
        p("Preservation check", "H2"),
        check("I retained an untouched original for each report."),
        check("The bureau/source and report date are visible."),
        check("Pages are complete and in order."),
        check("My working copy uses highlights or notes without changing the source text."),
        check("My storage location is access-controlled and backed up appropriately."),
        Spacer(1, 10),
        worksheet_lines(["Reviewer", "Review started", "Report set label", "Notes"], line_height=29),
    ])

    # 6 report anatomy
    add_page(story, "STEP 2", "Learn the anatomy before comparing", "Labels differ by source and bureau. Read the report's own legend before treating two labels as equivalent.", [
        data_table(
            ["AREA", "WHAT TO CAPTURE", "COMMON REVIEW QUESTION"],
            [
                ["Identity", "Names, addresses, employers, file identifiers", "Does this entry relate to me, and is it presented accurately?"],
                ["Account identity", "Furnisher, partial account number, type", "Am I comparing the same obligation across reports?"],
                ["Status", "Open/closed, current/delinquent, collection, charge-off", "What does this source label mean in this report's legend?"],
                ["Amounts", "Balance, past due, payment, limit or original amount", "Are the field labels and effective dates comparable?"],
                ["Dates", "Opened, updated, closed, payment or delinquency dates", "Which event does each date actually describe?"],
                ["History", "Month-by-month symbols or status grid", "Does the legend explain every symbol I am reading?"],
                ["Remarks", "Comments, dispute notation, responsibility", "Is the remark current, attributable, and supported?"],
                ["Inquiries / records", "Requester, date, type, public-record details", "Is the entry mine and is the identifying information accurate?"],
            ],
            [82, 167, 203],
        ),
        p("Never compare labels in isolation", "H2"),
        bullet("A balance may reflect a different update date than another bureau's balance."),
        bullet("Two account numbers may be masked differently."),
        bullet("A status summary may coexist with a separate historical grid."),
        bullet("A collector and original creditor can both appear without necessarily being duplicate reporting."),
        callout("Read the legend", "If you cannot define a symbol or field from the report itself, mark it <b>unknown</b> until you find reliable context."),
    ])

    # 7 inventory instructions
    add_page(story, "STEP 3", "Build an account inventory", "Create one normalized row for every item on every report before deciding what to dispute.", [
        p("Use stable identifiers", "H2"),
        bullet("Record the furnisher or collector exactly as shown."),
        bullet("Use only the last four digits or another safe partial identifier."),
        bullet("Give each item your own neutral ID, such as A-01, A-02, and A-03."),
        bullet("List bureau-specific appearances separately first; link them only after confirming they describe the same account."),
        p("Minimum fields", "H2"),
        data_table(
            ["IDENTITY", "STATUS / AMOUNTS", "DATES / HISTORY", "SOURCE"],
            [["Neutral ID; bureau; furnisher; partial account ID; responsibility", "Status; balance; past due; payment; limit/original amount", "Opened; updated; closed; key timeline dates; history symbols", "Report date; page; section; saved excerpt name"]],
            [113, 113, 113, 113],
        ),
        p("A useful inventory is descriptive, not argumentative", "H2"),
        callout("Good note", "“TransUnion report dated 08/22/2026, page 14, shows balance $___ and updated date ___.”"),
        Spacer(1, 7),
        callout("Too early", "“This account is illegal and must be deleted.” The inventory stage has not established either conclusion.", color=RED, fill=colors.HexColor("#FFF5F5")),
        p("Keep blanks honest. Write “not shown” when a field is absent and “unknown” when you do not yet understand it. Do not turn either into a zero, a date, or a fact.", "Small"),
    ])

    # 8 inventory worksheet
    add_page(story, "WORKSHEET 2", "Account inventory", "Use additional copies as needed. One row should describe one bureau appearance of one reporting item.", [
        blank_grid(
            ["ID", "BUREAU", "FURNISHER / COLLECTOR", "LAST 4", "STATUS", "BALANCE", "PAGE"],
            [30, 52, 140, 42, 76, 64, 48], row_count=9, row_height=38,
        ),
        Spacer(1, 14),
        callout("Safe notation", "Use partial identifiers only. If a full account number appears in a report, do not reproduce it in this worksheet."),
        Spacer(1, 12),
        worksheet_lines(["Report set label", "Inventory completed by", "Date completed", "Items needing identity match"], line_height=29),
    ])

    # 9 facts assumptions
    add_page(story, "STEP 4", "Separate source facts from assumptions", "This distinction is the heart of a truthful dispute file.", [
        data_table(
            ["TYPE", "DEFINITION", "EXAMPLE", "ACTION"],
            [
                ["Source fact", "A detail visible in a preserved document.", "“Report page 8 lists the account as open.”", "Cite the source and page."],
                ["Corroborated fact", "Two or more reliable records establish the same point.", "“The report and closing letter identify the same last four digits.”", "Retain both records."],
                ["Difference", "Sources show different values or labels.", "“One report lists $___; another lists $___.”", "Check dates and definitions."],
                ["Assumption", "A conclusion not yet supported by the record.", "“Different balances mean fraud.”", "Do not assert it as fact."],
                ["Unknown", "The source does not answer the question.", "“The report does not show which date controls.”", "Seek clarification or records."],
            ],
            [78, 128, 154, 92], font_style="TableCellSmall",
        ),
        p("The three-sentence test", "H2"),
        bullet("<b>The report says:</b> quote or accurately paraphrase the exact field and identify its page."),
        bullet("<b>My supporting record says:</b> identify the document, issuer, date, and relevant detail."),
        bullet("<b>Therefore I can truthfully ask:</b> request investigation or a specific correction that follows from those records."),
        callout("Example", "Report page 12 shows a late payment for March 2025. My statement dated April 2, 2025, shows the March amount received on March 15. Please investigate the March 2025 payment-history notation and correct it if it cannot be verified as accurate."),
        p("Avoid upgrading a concern into certainty. “I do not recognize this” is different from “this is identity theft.” “These values differ” is different from “the lower value is correct.”", "Small"),
    ])

    # 10 claim ledger worksheet
    add_page(story, "WORKSHEET 3", "Fact / assumption ledger", "For each concern, write the strongest statement your actual records support - no stronger.", [
        blank_grid(
            ["ITEM / FIELD", "REPORT FACT + PAGE", "SUPPORTING FACT + SOURCE", "UNKNOWN / ASSUMPTION", "SAFE NEXT STEP"],
            [78, 103, 113, 88, 70], row_count=6, row_height=52,
        ),
        Spacer(1, 10),
        check("Every “fact” above is visible in a saved source."),
        check("Every difference accounts for report dates and field definitions."),
        check("I did not state a legal conclusion I cannot establish."),
        check("I marked unresolved questions as unknown."),
    ])

    # 11 evidence
    add_page(story, "STEP 5", "Build an evidence packet", "Relevant, readable, safely redacted support is more useful than a pile of unrelated pages.", [
        p("Evidence hierarchy", "H2"),
        data_table(
            ["STRONGER CONNECTION", "USE WITH CARE", "NOT PROOF BY ITSELF"],
            [["Official account statements; payment confirmations; creditor correspondence; court or government records; identity records when necessary", "Bank records with unrelated transactions; screenshots without source/date context; third-party summaries", "Your recollection; a template claim; social-media advice; another person's result; a difference with no date/definition analysis"]],
            [151, 151, 150],
        ),
        p("Create a simple exhibit index", "H2"),
        bullet("Exhibit A: relevant report page, with the exact item marked on a working copy."),
        bullet("Exhibit B: supporting statement or letter showing the contradictory detail."),
        bullet("Exhibit C: additional support only if it materially helps identify or verify the issue."),
        p("Redact safely", "H2"),
        check("Retain the unredacted original securely."),
        check("Send only information reasonably needed for identification and investigation."),
        check("Redact unrelated account numbers, transactions, medical information, and household-member data."),
        check("After redacting, export/print a new copy and verify hidden text cannot be revealed or copied."),
        check("Never use opaque rectangles that merely cover live text in an editable file."),
        callout("Quality check", "Open every enclosure as the recipient would. Confirm it is legible, oriented correctly, complete enough to understand, and tied to one of your factual statements."),
    ])

    # 12 evidence index worksheet
    add_page(story, "WORKSHEET 4", "Evidence index", "Give every enclosure a purpose. If you cannot explain why it matters, do not automatically include it.", [
        blank_grid(
            ["EXHIBIT", "DOCUMENT / ISSUER", "DATE", "WHAT IT ESTABLISHES", "REDactions CHECKED", "PAGES"],
            [47, 113, 60, 137, 59, 36], row_count=7, row_height=43,
        ),
        Spacer(1, 12),
        worksheet_lines(["Packet relates to item ID", "Issue being supported", "Unredacted originals stored at", "Final packet reviewed by"], line_height=30),
    ])

    # 13 truthful issues
    add_page(story, "STEP 6", "Select truthful, supportable issues", "A focused letter can be easier to understand and investigate than a broad list of every possible complaint.", [
        data_table(
            ["POSSIBLE REVIEW AREA", "VERIFY BEFORE ASSERTING"],
            [
                ["Identity / ownership", "What records connect or do not connect you to the item? Is this a recognition issue, mixed identity concern, or documented identity theft?"],
                ["Account identity", "Do bureau entries truly refer to the same obligation? Compare furnisher, collector, dates, balance, and masked number."],
                ["Status", "What does the report's label mean, and what dated source shows a different status?"],
                ["Amounts", "Are balance, past due, payment, limit, and original amount separate fields? Do update dates differ?"],
                ["Dates", "Which event does each date represent? Do not assume opened, updated, closed, or delinquency dates are interchangeable."],
                ["Payment history", "Which bureau, month, symbol, and supporting statement are involved?"],
                ["Remarks / responsibility", "What exact remark or responsibility code appears, and what reliable record contradicts it?"],
                ["Reporting age", "What event and rule control for this information? Verify the current law and complete timeline before claiming obsolescence."],
            ],
            [125, 327], font_style="TableCellSmall",
        ),
        p("Selection test", "H2"),
        check("I can identify the recipient, bureau, account, and exact field."),
        check("I can cite the report date and page."),
        check("I have reliable support or I have clearly framed the issue as a request to investigate an unknown."),
        check("My requested outcome follows from the issue and does not demand deletion without a factual basis."),
        callout("Truth over volume", "Do not dispute accurate information, invent a reason, copy allegations that do not match your file, or submit the same unsupported statement repeatedly."),
    ])

    # 14 issue selection worksheet
    add_page(story, "WORKSHEET 5", "Issue selection sheet", "Complete one row per issue you may include. The “why truthful” column is your internal accuracy check.", [
        blank_grid(
            ["ITEM ID", "BUREAU + FIELD", "EXACT ISSUE", "WHY TRUTHFUL / SUPPORT", "REQUEST", "INCLUDE?"],
            [48, 82, 98, 130, 66, 28], row_count=7, row_height=47,
        ),
        Spacer(1, 12),
        callout("Before writing", "Choose the clearest supported issues. Leave unresolved guesses in your research notes rather than presenting them as established facts."),
    ])

    # 15 letter anatomy
    add_page(story, "STEP 7", "The anatomy of a factual letter", "Make it easy for a reader to identify you, locate the item, understand the issue, review the support, and respond.", [
        data_table(
            ["PART", "PURPOSE", "INCLUDE"],
            [
                ["Sender + date", "Identify the consumer and correspondence date.", "Name, safe return address, date actually sent."],
                ["Recipient", "Route the request correctly.", "Current recipient name/address verified from an official source."],
                ["Subject", "Describe the communication.", "Credit report dispute or investigation request; report/file reference if appropriate."],
                ["Identification", "Help locate the file/item.", "Only the information reasonably requested; partial account identifier in the letter body."],
                ["Issue statement", "Define one testable concern.", "Bureau, furnisher, field, displayed value, report date/page."],
                ["Supporting facts", "Show why the issue deserves investigation.", "Document name, issuer, date, and relevant fact."],
                ["Request", "State what you want done.", "Investigate and correct, delete, or clarify only as supported by your facts."],
                ["Enclosures", "Connect evidence to the letter.", "A short exhibit list; copies rather than irreplaceable originals."],
                ["Signature", "Close the correspondence.", "Your truthful signature and a retained final copy."],
            ],
            [82, 135, 235], font_style="TableCellSmall",
        ),
        callout("Tone", "Clear and specific beats dramatic. Avoid threats, invented deadlines, legal conclusions you have not verified, and accusations unsupported by your documents."),
    ])

    # 16 fill-in framework
    add_page(story, "WORKSHEET 6", "Fill-in correspondence framework", "Draft from facts. Replace every bracket with your real information and remove any sentence that does not apply.", [
        callout("Important", "This is a writing framework, not a prewritten legal demand. Verify the recipient's current instructions and address before sending."),
        Spacer(1, 8),
        p("<b>[Your full name]</b><br/>[Your mailing address]<br/>[City, state ZIP]<br/>[Date actually sent]", "Body"),
        p("<b>[Recipient name]</b><br/>[Recipient dispute address]<br/>[City, state ZIP]", "Body"),
        p("<b>Subject: Request to investigate specific credit-report information</b>", "Body"),
        p("To whom it may concern:", "Body"),
        p("I am writing about <b>[bureau/source]</b> report dated <b>[date]</b>. On page <b>[page]</b>, <b>[furnisher/collector]</b>, account ending <b>[last four only]</b>, shows <b>[exact field and displayed value]</b>.", "Quote"),
        p("I dispute this specific information because <b>[concise, truthful reason supported by your records]</b>. <b>[Supporting document name]</b>, dated <b>[date]</b>, shows <b>[exact supporting fact]</b>. A copy is enclosed as <b>[Exhibit]</b>.", "Quote"),
        p("Please investigate the identified information and <b>[correct it to the supported value / delete it if it cannot be verified accurately / provide the result appropriate to your documented facts]</b>. Please send the results and an updated report or other response available under the process that applies.", "Quote"),
        p("Sincerely,<br/><br/>[Signature]<br/>[Printed name]", "Body"),
        p("Enclosures: [Exhibit A - ...]; [Exhibit B - ...]", "Small"),
        callout("Do not", "Backdate the letter; use a fabricated identity-theft claim; include someone else's facts; state that a difference automatically proves illegality; or leave unused bracket text in the final copy.", color=RED, fill=colors.HexColor("#FFF5F5")),
    ])

    # 17 drafting worksheet
    add_page(story, "WORKSHEET 7", "Letter drafting canvas", "Write the facts in plain language before assembling the final letter.", [
        worksheet_lines([
            "Recipient + verified address",
            "Report source + date + page",
            "Furnisher + last four",
            "Exact field + displayed value",
            "Truthful issue statement",
            "Supporting document + date",
            "Exact supporting fact",
            "Requested investigation / correction",
            "Enclosures",
        ], line_height=35),
        Spacer(1, 12),
        p("Plain-language review", "H2"),
        check("A reader can tell exactly what field I dispute."),
        check("Each factual sentence traces to a source."),
        check("My request matches what the evidence could establish."),
        check("I removed anger, filler, copied legal claims, and irrelevant history."),
    ])

    # 18 attachments and sending
    add_page(story, "STEP 8", "Assemble and send safely", "Follow the recipient's current submission instructions and keep a complete, dated record of exactly what left your hands.", [
        p("Final packet order", "H2"),
        check("Signed final letter."),
        check("Copy of the relevant report page or excerpt with enough context to identify the source."),
        check("Relevant supporting records, labeled to match the enclosure list."),
        check("Identity/address documents only when required, with unnecessary data minimized."),
        p("Choose a submission method", "H2"),
        bullet("Use an official address, portal, or channel currently designated for the type of request you are making."),
        bullet("Select a mailing or electronic method that gives you the record you reasonably need. Availability and evidentiary value vary."),
        bullet("If submitting online, save confirmation pages, reference numbers, uploaded filenames, and the exact text entered."),
        bullet("If mailing, retain the final packet and the postal or carrier record showing the actual send date."),
        p("Before sealing or clicking submit", "H2"),
        check("Recipient is correct; address or portal is current."),
        check("Dates are real and not backdated."),
        check("Every exhibit is referenced and legible."),
        check("No originals are included unless specifically necessary and safe."),
        check("Unrelated sensitive data is removed safely."),
        callout("One source of truth", "Save the final sent version as a read-only PDF and record its filename in the mailing log. Do not rely on a draft that may later change."),
    ])

    # 19 mailing log
    add_page(story, "WORKSHEET 8", "Correspondence and delivery log", "Use one row per recipient and submission. Dates should come from records, not memory.", [
        blank_grid(
            ["SENT", "RECIPIENT", "ITEM / ISSUE", "METHOD + TRACKING / CONFIRMATION", "DELIVERED / RECEIVED", "RESPONSE DUE?*"],
            [48, 82, 88, 130, 62, 42], row_count=7, row_height=48,
        ),
        Spacer(1, 10),
        p("*A planning date is not a legal conclusion. Calculate only after identifying the process, confirming receipt where relevant, and checking current official guidance for extensions or exceptions.", "Tiny"),
        Spacer(1, 12),
        worksheet_lines(["Final packet filename", "Proof stored at", "Follow-up reminder", "Notes"], line_height=30),
    ])

    # 20 deadlines
    add_page(story, "STEP 9", "Track timing without blanket claims", "Different recipients, request types, delivery events, and circumstances can produce different timelines.", [
        callout("Avoid the shortcut", "Do not write “they always have 30 days” in your log or letter. A commonly discussed period may not apply exactly as assumed, and extensions, exceptions, or different rules may matter."),
        p("Build a defensible timing note", "H2"),
        data_table(
            ["QUESTION", "YOUR SOURCE"],
            [
                ["What process did I use?", "Official recipient instructions and a copy of my submission."],
                ["What event starts timing?", "The governing rule/guidance and proof of the relevant event, such as receipt if applicable."],
                ["What period applies?", "Current official statute, regulation, agency guidance, or qualified advice matched to my facts."],
                ["Could it be extended or changed?", "Check for additional information, method-specific terms, weekends/holidays, exceptions, or another applicable process."],
                ["What actually happened?", "Delivery record, confirmation, response date, and fresh report date."],
            ],
            [175, 277],
        ),
        p("Practical tracking", "H2"),
        bullet("Record the actual sent date and any confirmed receipt date separately."),
        bullet("Set an internal review reminder before your calculated checkpoint."),
        bullet("Keep envelopes, electronic headers, notices, and any request for more information."),
        bullet("If timing becomes legally significant, verify the current rule or seek qualified help rather than relying on a template."),
        worksheet_lines(["Process used", "Receipt event/source", "Rule/guidance checked", "Planning checkpoint", "Possible extension/exception", "Actual response date"], line_height=26),
    ])

    # 21 response analysis
    add_page(story, "STEP 10", "Analyze the response against your issue", "A response is not the finish line. Compare it to what you actually sent and what the current report now shows.", [
        p("Three-document comparison", "H2"),
        data_table(
            ["YOUR LETTER", "THE RESPONSE", "THE FRESH REPORT"],
            [["What exact item, field, value, support, and request did you identify?", "What did the recipient say was investigated, changed, verified, deleted, or not processed? What dates and references appear?", "What does the same item show now? Are the source, date, field labels, and account identity comparable?"]],
            [151, 151, 150],
        ),
        p("Classify the outcome descriptively", "H2"),
        bullet("<b>Corrected as requested:</b> the disputed field now matches the supported value."),
        bullet("<b>Changed differently:</b> information changed, but not in the way you requested."),
        bullet("<b>Reported as verified / unchanged:</b> preserve the response and determine what, if anything, it explains."),
        bullet("<b>Deleted or removed:</b> identify the item and date; do not assume permanence or a reason not stated."),
        bullet("<b>Unable to process / more information needed:</b> record the exact reason and requirements."),
        bullet("<b>No response located:</b> re-check delivery, timing, address/channel, and records before deciding what that means."),
        callout("Fresh evidence", "Obtain a new report or reliable current view when needed. Do not infer the present status from an old report or from a response summary alone."),
    ])

    # 22 response worksheet
    add_page(story, "WORKSHEET 9", "Response analysis", "Complete one sheet per response or recipient.", [
        worksheet_lines([
            "Recipient + response date",
            "Reference / confirmation",
            "Original item + disputed field",
            "Original request",
            "Response wording (brief, exact)",
            "Fresh report source + date + page",
            "Current displayed value",
            "Evidence still unresolved",
            "Outcome description",
        ], line_height=32),
        Spacer(1, 12),
        p("Completeness check", "H2"),
        check("I compared the response with the exact sent letter, not a draft."),
        check("I saved the response, envelope/email metadata, and fresh report."),
        check("I distinguished “verified,” “unchanged,” and “correct.”"),
        check("I did not assume why a change occurred unless the response says so."),
    ])

    # 23 decision tree
    add_page(story, "STEP 11", "Decide the next step from the record", "Your next action should have a written reason, a defined purpose, and support that improves the file.", [
        data_table(
            ["WHAT THE RECORD SHOWS", "POSSIBLE NEXT STEP TO EVALUATE"],
            [
                ["The specific supported issue was corrected", "Archive the result, update your log, and monitor future reports for accuracy."],
                ["The response requests identifiable missing information", "Confirm the request is legitimate and relevant; provide only what is safely necessary through an official channel."],
                ["The item is unchanged and your evidence remains clear", "Review whether the prior letter precisely stated the issue and whether additional reliable evidence or an appropriate current process is available."],
                ["You discovered your assumption was wrong", "Correct your notes, stop asserting the unsupported issue, and retain the learning trail."],
                ["The response or report creates a new, distinct factual issue", "Document it separately; do not silently rewrite the original claim."],
                ["The matter involves fraud, mixed files, litigation, court records, regulatory complaints, or material harm", "Consider current official resources or advice from a qualified professional appropriate to the issue."],
                ["You have no new fact, document, or clarification", "Pause. Repetition alone does not strengthen an unsupported claim."],
            ],
            [192, 260],
        ),
        p("Next-step memo", "H2"),
        worksheet_lines([
            "Decision",
            "Facts supporting this decision",
            "What changed since last submission",
            "Purpose of next action",
            "Risk / privacy check",
            "Review date",
        ], line_height=28),
    ])

    # 24 master checklist
    add_page(story, "FINAL WORKSHEET", "DIY accuracy master checklist", "Use this one-page control sheet for each complete review cycle.", [
        data_table(
            ["PHASE", "CONTROL CHECK"],
            [
                ["Reports", "[ ] Three current reports saved &nbsp; [ ] Source/date visible &nbsp; [ ] Originals preserved"],
                ["Inventory", "[ ] Each bureau appearance logged &nbsp; [ ] Partial IDs only &nbsp; [ ] Pages cited"],
                ["Analysis", "[ ] Legends read &nbsp; [ ] Dates/definitions compared &nbsp; [ ] Unknowns labeled"],
                ["Evidence", "[ ] Each claim supported &nbsp; [ ] Exhibits indexed &nbsp; [ ] Redactions verified"],
                ["Selection", "[ ] Issues truthful &nbsp; [ ] Exact fields identified &nbsp; [ ] Requests evidence-matched"],
                ["Letter", "[ ] Recipient verified &nbsp; [ ] Brackets removed &nbsp; [ ] Dates real &nbsp; [ ] Signed"],
                ["Send", "[ ] Final packet saved &nbsp; [ ] Method recorded &nbsp; [ ] Proof retained"],
                ["Timing", "[ ] Process identified &nbsp; [ ] Current guidance checked &nbsp; [ ] Exceptions considered"],
                ["Response", "[ ] Exact sent copy compared &nbsp; [ ] Fresh report checked &nbsp; [ ] Outcome described"],
                ["Next step", "[ ] Written rationale &nbsp; [ ] New evidence identified &nbsp; [ ] Privacy re-checked"],
            ],
            [82, 370], font_style="TableCellSmall",
        ),
        Spacer(1, 12),
        worksheet_lines(["Review cycle label", "Started", "Completed", "Open questions", "Next review date"], line_height=29),
        Spacer(1, 12),
        callout("The standard", "A careful file is reproducible: another reader can follow each statement back to a source, see what was sent, and understand why the next step was chosen."),
        Spacer(1, 12),
        p("Credit Comeback Club, LLC", "H2"),
        p("This workbook is educational information for organizing a credit-report accuracy review. It is not legal advice, does not create an attorney-client relationship, and does not promise deletions, score changes, or any other outcome. Verify current official instructions and rules for your situation.", "Small"),
    ])

    # 25 client experiences
    add_page(story, "CLIENT EXPERIENCES", "What the process felt like", "Results vary. These already-published CCC client experiences speak to education, communication, and real-life goals - not a promised outcome.", [
        proof_card(
            "What made Credit Comeback Club different was the education piece. Chris doesn't just send letters and collect a check - he explains the process. My score went up 110 points.",
            "Jasmine W.",
            "CCC client · Education and a reported 110-point change",
        ),
        Spacer(1, 12),
        proof_card(
            "I was in a pinch trying to buy a new house. Chris said he might be able to help. He got my 615 credit score to over 710 in unbelievable time. Two and a half years later, I'm in my new house and still grateful.",
            "Noah P.",
            "CCC client · Homebuying goal",
        ),
        Spacer(1, 12),
        proof_card(
            "He doesn't leave you in the dark like a lot of credit repair gurus do. I've had much success using Chris's methods, as have the clients I've referred to him.",
            "Karl E.",
            "CCC client and referral partner · Communication and support",
        ),
        Spacer(1, 10),
        p("Testimonials describe individual experiences previously published by Credit Comeback Club. They do not promise a deletion, score change, timeline, approval, or any other outcome. Score sources and scoring models may differ.", "Tiny"),
    ])

    # 26 respectful DIY-to-service handoff
    story.extend(page_title(
        "YOUR NEXT MOVE",
        "You can do this yourself. You do not have to do it alone.",
        "This guide gives you a complete starting system. The real work is applying it carefully, preserving the record, and making disciplined decisions as new information arrives.",
    ))
    cta_panel = Table([[ [
        Paragraph("DIY is absolutely possible.", styles["CTAHeadline"]),
        Paragraph(
            "But reading three reports line by line, organizing evidence, drafting factual correspondence, tracking every submission, and reviewing each response takes time and attention to detail. If you would rather have an experienced team manage that workload with you, let's talk.",
            styles["CTABody"],
        ),
        Spacer(1, 8),
        consultation_button(),
        Spacer(1, 12),
        Paragraph(
            "No pressure. No guaranteed outcomes. We will look at where you are, what you are trying to accomplish, and whether CCC is a sensible fit.",
            ParagraphStyle("CTAFinePrint", parent=styles["Small"], fontSize=8.2, leading=11.5, textColor=MID, alignment=TA_CENTER),
        ),
    ] ]], colWidths=[PAGE_W - 92], hAlign="LEFT")
    cta_panel.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#183B66")),
        ("LEFTPADDING", (0, 0), (-1, -1), 24),
        ("RIGHTPADDING", (0, 0), (-1, -1), 24),
        ("TOPPADDING", (0, 0), (-1, -1), 24),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 24),
    ]))
    story.append(cta_panel)
    story.append(Spacer(1, 18))
    story.append(p("Bring these to the conversation", "H2"))
    story.append(check("Your current three-bureau reports, if available."))
    story.append(check("The two or three items creating the most confusion or urgency."))
    story.append(check("Your real-world goal - housing, transportation, funding readiness, or simply a cleaner record."))
    story.append(check("Any known deadline, denial notice, or recent correspondence you want us to understand."))
    story.append(Spacer(1, 12))
    story.append(callout(
        "Prefer the website?",
        '<link href="https://creditcomebackclub.com/#consultation" color="#2176B2"><b>creditcomebackclub.com/#consultation</b></link>',
    ))
    story.append(Spacer(1, 10))
    story.append(callout(
        "Keep learning with CCC",
        "Your DIY work gets easier when you have a place to keep learning. Join more than 280 members in CCC's free Facebook group for practical credit education, honest conversation, and encouragement as you work toward your comeback. No miracle promises - just better questions and real next steps.<br/><br/>"
        '<link href="https://www.facebook.com/groups/creditcomebackclub" color="#2176B2"><b>Join the free Credit Comeback Club community</b></link>',
    ))
    story.append(Spacer(1, 10))
    story.append(p("Credit Comeback Club, LLC · Veteran-owned · Attention to detail from report review through follow-through.", "Small"))

    # Remove terminal page break to avoid an empty page.
    if isinstance(story[-1], PageBreak):
        story.pop()
    return story


def build_pdf(output: Path = OUTPUT):
    output.parent.mkdir(parents=True, exist_ok=True)
    doc = NumberedDocTemplate(
        str(output), pagesize=letter,
        leftMargin=46, rightMargin=46, topMargin=54, bottomMargin=46,
        title="The Credit Report Field Guide",
        author="Credit Comeback Club, LLC",
        subject="DIY credit report accuracy review workbook",
        creator="Credit Comeback Club",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="content")
    doc.addPageTemplates([PageTemplate(id="guide", frames=[frame], onPage=page_chrome)])
    doc.build(build_story())


if __name__ == "__main__":
    build_pdf()
    print(f"Built {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")
