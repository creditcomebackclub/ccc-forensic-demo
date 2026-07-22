const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Find Karl's profile to get signature URL
    const { data: profiles, error: profileErr } = await supabase
      .from('client_profiles')
      .select('*')
      .ilike('full_name', '%Karl%Elliott%');

    if (profileErr) throw profileErr;
    if (!profiles || profiles.length === 0) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Karl Elliott not found' }) };
    }

    const karl = profiles[0];
    const signatureUrl = karl.signature_data || 'https://mlsbdmewxocgweotcdud.supabase.co/storage/v1/object/public/client-docs/standalone/Karl%20Elliott/signature.png'; 
    // Fallback in case it's not stored in the db directly but exists in storage or something
    
    const htmlTemplate = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.5; margin: 0; padding: 40px; color: #000; }
.header { margin-bottom: 24px; }
.subject { font-weight: bold; margin: 16px 0; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 10pt; }
th, td { border: 1px solid #000; padding: 8px; text-align: left; }
th { background-color: #0f172a; color: #fff; }
.sig-block { margin-top: 32px; }
.sig-line { margin-bottom: 4px; min-height: 60px; display: flex; align-items: flex-end; }
</style>
</head>
<body>
<div class="header">
May 1, 2026<br><br>
<strong>Karl J. Elliott, Jr.</strong><br>
3712 11th W<br>
Lehigh Acres, FL 33971<br>
Previous Address: 1720 Oak Dr, Fremont, OH 43420<br><br>
<strong>TransUnion, LLC</strong><br>
Consumer Dispute Center<br>
P.O. Box 2000<br>
Chester, PA 19016
</div>

<div class="subject">
RE: SECOND NOTICE — Escalation of Unanswered Dispute &amp; Renewed Formal Dispute<br>
Disputed Item: Chapter 7 Bankruptcy Public Record — Case No. 24-30876-maw<br>
Consumer: Karl J. Elliott, Jr. | SSN ending 1197<br>
Current Address: 3712 11th W, Lehigh Acres, FL 33971<br>
Previous Address: 1720 Oak Dr, Fremont, OH 43420 (address on prior report)<br>
Original Dispute Submitted: On or about March 4, 2026<br>
<span style="color:red">Active Fraud Alert on File: Yes — Placed 02/13/2026 (All Three Bureaus)</span>
</div>

<p>Dear TransUnion Consumer Dispute Center:</p>
<p>This is a formal SECOND NOTICE. On or about March 4, 2026, I submitted a detailed written dispute to TransUnion challenging the accuracy and verifiability of a Chapter 7 bankruptcy public record (Case No. 24-30876-maw) appearing in my consumer file. That dispute was accompanied by certified federal court records obtained directly from PACER. To date — nearly sixty (60) days later — TransUnion has provided no reinvestigation results, no written notice of any kind, and no acknowledgment of the dispute. This silence is itself a violation of the Fair Credit Reporting Act.</p>

<p><strong>This letter serves two simultaneous functions: (1) it formally documents TransUnion's failure to comply with the mandatory reinvestigation timeline under 15 U.S.C. §1681i; and (2) to the extent TransUnion contends it did not receive the original dispute, it constitutes a RENEWED formal dispute, and TransUnion's statutory obligations run anew from the date of receipt of this letter.</strong></p>

<h3 style="background:#0f172a; color:#fff; padding:6px 12px; margin:24px -12px 12px;">PART I — TRANSUNION'S FAILURE TO REINVESTIGATE IS A STATUTORY VIOLATION</h3>
<p>The FCRA imposes strict, non-discretionary deadlines on a consumer reporting agency once it receives a dispute:</p>

<table>
<tr><th>Statutory Duty</th><th>TransUnion's Performance</th></tr>
<tr><td>15 U.S.C. §1681i(a)(1)(A) — Complete a reasonable reinvestigation within 30 days</td><td style="color:#b91c1c; font-weight:bold;">FAILED. Approximately 60 days have elapsed since the dispute was submitted. No reinvestigation results have been provided.</td></tr>
<tr><td>15 U.S.C. §1681i(a)(6)(A) — Provide written notice of results within 5 days of completion</td><td style="color:#b91c1c; font-weight:bold;">FAILED. No written notice of results, and no communication of any kind, has been received.</td></tr>
<tr><td>15 U.S.C. §1681i(a)(5)(A) — Delete information that cannot be verified within the reinvestigation period</td><td style="color:#b91c1c; font-weight:bold;">TRIGGERED. Because TransUnion has not verified the disputed item within the statutory period, deletion is now required.</td></tr>
</table>

<p>Under 15 U.S.C. §1681i(a)(5)(A), if a disputed item "cannot be verified" within the reinvestigation period, the consumer reporting agency "shall promptly delete that item of information from the file of the consumer, or modify that item of information, as appropriate, based on the results of the reinvestigation." TransUnion has now allowed the statutory period to lapse without verifying this item. Deletion is not discretionary — it is mandated.</p>

<h3 style="background:#0f172a; color:#fff; padding:6px 12px; margin:24px -12px 12px;">PART II — THE UNDERLYING GROUNDS REMAIN VALID AND UNADDRESSED</h3>
<p>The original dispute established, with certified court documentation, that TransUnion's reporting of this public record contains multiple field-level inaccuracies inconsistent with the official record. These grounds remain entirely unaddressed:</p>

<table>
<tr><th>Data Field</th><th>Official PACER Record</th><th>TransUnion Reports</th></tr>
<tr><td>Debtor Legal Name</td><td>Karl J. Elliott, Jr.</td><td style="color:#b91c1c; font-weight:bold;">Karl Joseph Elliott — middle name altered; "Jr." suffix omitted</td></tr>
<tr><td>Case Number</td><td>24-30876-maw</td><td style="color:#b91c1c; font-weight:bold;">2430876 — year prefix and judicial suffix omitted</td></tr>
<tr><td>Court / District</td><td>U.S. Bankruptcy Court, Northern District of Ohio (Toledo)</td><td style="color:#b91c1c; font-weight:bold;">U.S. Bankruptcy Court — district and division not identified</td></tr>
<tr><td>Bureau Reporting</td><td>Same federal PACER source underlies all bureaus</td><td style="color:#b91c1c; font-weight:bold;">Reported by TransUnion ONLY — absent from Experian and Equifax</td></tr>
<tr><td>Procedural History</td><td>Case closed without discharge 09/04/2024; reopened 10/10/2024; discharged 10/29/2024</td><td style="color:#b91c1c; font-weight:bold;">Reported as straightforward — raising the question of whether the vendor captured a pre-discharge status</td></tr>
</table>

<p>The name discrepancy alone — <strong>"Karl J. Elliott, Jr."</strong> on the certified court order versus <strong>"Karl Joseph Elliott"</strong> in TransUnion's file — demonstrates the data was not sourced directly from the court record, but through a commercial aggregator that introduced transcription alterations. TransUnion has never verified these fields against the certified records, which were enclosed with the original dispute and are enclosed again herewith.</p>

<h3 style="background:#0f172a; color:#fff; padding:6px 12px; margin:24px -12px 12px;">PART III — NOTICE OF WILLFUL NONCOMPLIANCE AND REGULATORY ESCALATION</h3>
<p>A documented dispute, supported by certified primary-source federal court records, followed by approximately 60 days of complete silence, establishes a pattern consistent with willful noncompliance under 15 U.S.C. §1681n. Willful noncompliance exposes TransUnion to statutory damages of $100 to $1,000 per violation, punitive damages, and attorney's fees and costs — without any requirement that the consumer prove actual damages.</p>
<p><strong>Be advised that I am filing formal complaints with the Consumer Financial Protection Bureau (CFPB) and the Office of the Ohio Attorney General documenting TransUnion's failure to comply with the FCRA's mandatory reinvestigation provisions. I am further evaluating civil remedies under 15 U.S.C. §1681n and §1681o. This letter, the original dispute, and the certified court records will serve as documentary evidence of the violation.</strong></p>

<h3 style="background:#0f172a; color:#fff; padding:6px 12px; margin:24px -12px 12px;">FORMAL DEMANDS</h3>
<p>I demand the following:</p>
<ol>
<li>PRIMARY DEMAND — DELETION: Because TransUnion has failed to verify the disputed Chapter 7 public record within the statutory reinvestigation period, immediately DELETE this public record entry (Case No. 24-30876-maw) from my consumer file in its entirety, as required by 15 U.S.C. §1681i(a)(5)(A), and provide written confirmation of the deletion.</li>
<li>ALTERNATIVE — RENEWED REINVESTIGATION: To the extent TransUnion contends it did not receive the original dispute, treat this letter as a renewed formal dispute and conduct a manual, substantive reinvestigation against the enclosed certified PACER records (Case No. 24-30876-maw) — not against commercial aggregator data — within 30 days of receipt of this letter.</li>
<li>IDENTIFY THE SOURCE: Disclose in writing the specific third-party data vendor (aggregator) from which TransUnion obtained this public record and the exact date the record was captured from PACER, including whether that capture date preceded the September 4, 2024 pre-discharge closure of the case.</li>
<li>CORRECT THE FIELDS: If not deleted, correct the debtor name to the legally accurate "Karl J. Elliott, Jr." and the case number to the full official format "24-30876-maw," and identify the court as the U.S. Bankruptcy Court, Northern District of Ohio (Toledo Division).</li>
<li>EXPLAIN THE ASYMMETRY: Explain in writing why this public record appears on TransUnion but not on Experian or Equifax.</li>
<li>DOCUMENT FRAUD-ALERT HANDLING: Document the heightened-review procedures applied to this adverse public record in light of the active Fraud Alert on file (placed 02/13/2026).</li>
<li>PROVIDE WRITTEN RESULTS: Provide written notice of the results within 5 days of completing any reinvestigation, per 15 U.S.C. §1681i(a)(6), including the name, address, and telephone number of every source contacted.</li>
<li>DEADLINE: Confirm deletion in writing within FIFTEEN (15) DAYS of receipt of this letter, or, if proceeding under the alternative renewed-reinvestigation track, provide compliant written results within the 30-day statutory period.</li>
</ol>

<p>This is a time-sensitive legal matter. TransUnion's continued failure to act will be treated as confirmation of willful noncompliance and will support the regulatory complaints and civil remedies described above.</p>

<p>Respectfully,</p>
<div class="sig-block">
  <div class="sig-line">
    ${signatureUrl ? \`<img src="\${signatureUrl}" style="max-height:60px;" alt="Signature" />\` : ''}
  </div>
  <strong>Karl J. Elliott, Jr.</strong><br>
  Consumer — All Rights Reserved<br>
  3712 11th W, Lehigh Acres, FL 33971<br>
  <span style="color:#666; font-size:10pt;">Sent via USPS Certified Mail — Return Receipt Requested</span>
</div>

<h3 style="background:#0f172a; color:#fff; padding:6px 12px; margin:32px -12px 12px;">ENCLOSURES:</h3>
<table>
<tr><th>#</th><th>Document</th><th>Purpose</th></tr>
<tr><td>1</td><td>Government-issued photo ID — State of Florida (Karl J. Elliott, Jr.)</td><td>Identity and current address verification — 3712 11th W, Lehigh Acres, FL 33971</td></tr>
<tr><td>2</td><td>Copy of original dispute letter submitted on or about 03/04/2026</td><td>Documents the prior dispute and the grounds that remain unaddressed</td></tr>
<tr><td>3</td><td>PACER Docket Report — Case No. 24-30876-maw</td><td>PRIMARY EVIDENCE — full case number, procedural history, all official case events</td></tr>
<tr><td>4</td><td>Order of Discharge — Doc 29, entered 10/29/2024</td><td>PRIMARY EVIDENCE — official discharge under 11 U.S.C. §727; name as filed: Karl J. Elliott, Jr.</td></tr>
<tr><td>5</td><td>BNC Certificate of Notice — Doc 30, filed 10/31/2024</td><td>PRIMARY EVIDENCE — certified record of all parties notified of the discharge</td></tr>
<tr><td>6</td><td>3-Bureau credit report excerpt (02/25/2026)</td><td>Shows the public record on TransUnion only; absent from Experian and Equifax</td></tr>
<tr><td>7</td><td>Fraud Alert confirmation (all three bureaus, 02/13/2026)</td><td>Establishes the active fraud alert triggering heightened-review obligations</td></tr>
</table>

<p style="font-size:10pt; color:#666; margin-top:16px;">Enclosures 3, 4, and 5 are certified federal court records obtained directly from PACER, Case No. 24-30876-maw, U.S. Bankruptcy Court, Northern District of Ohio. TransUnion's reinvestigation must be conducted against these primary source records — not against any commercial aggregator's secondary reproduction of them.</p>

</body>
</html>`;

    // Insert into letters table
    const { data: inserted, error: insertErr } = await supabase
      .from('letters')
      .insert({
        client_name: karl.full_name,
        furnisher: 'TransUnion',
        phase: 'Round 2 - Escalation',
        type: 'Credit Bureau',
        html_content: htmlTemplate,
        status: 'Queued',
        saved_at: new Date().toISOString()
      })
      .select();

    if (insertErr) throw insertErr;

    return { statusCode: 200, body: JSON.stringify({ success: true, data: inserted, signature: signatureUrl }) };
  } catch (error) {
    console.error('Error inserting Karl letter:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message || error }) };
  }
};
