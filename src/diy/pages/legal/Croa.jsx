import { Link } from 'react-router-dom';
import { LegalShell } from '../../components/SiteChrome';

export default function Croa() {
  return (
    <LegalShell title="Statement of Consumer Rights" eyebrow="CROA disclosure · 15 U.S.C. § 1679c">
      <p className="rounded border border-[var(--fw-line)] bg-white px-4 py-3 text-sm text-[var(--fw-muted)]">
        The Credit Repair Organizations Act requires that consumers receive a clear statement of rights
        before purchasing certain credit-repair services. Fieldwork provides this statement so your rights
        are visible and easy to find. Whether any particular feature set is treated as a “credit repair
        organization” service under federal or state law depends on facts and counsel’s advice — this page
        does not waive any rights.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">
        Statement of Consumer Rights Under the Credit Repair Organizations Act
      </h2>

      <p>
        <strong>(A) YOU HAVE A RIGHT TO DISPUTE INACCURATE INFORMATION IN YOUR CREDIT REPORT BY CONTACTING
        THE CREDIT BUREAU DIRECTLY.</strong>{' '}
        The credit bureau must investigate your dispute at no cost to you, and correct or delete any
        inaccurate, incomplete, or unverifiable information within 30 days (or 45 days in certain
        circumstances).
      </p>

      <p>
        <strong>(B) YOU MAY ALSO HAVE THE RIGHT TO SUE A CREDIT REPAIR ORGANIZATION THAT VIOLATES THE CREDIT
        REPAIR ORGANIZATIONS ACT.</strong>{' '}
        This law prohibits deceptive practices by credit repair organizations. For example, the law prohibits
        a credit repair organization from:
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Charging or receiving any payment before the organization has fully performed the services it promised;</li>
        <li>Making any untrue or misleading statements about the services it will provide;</li>
        <li>Advising you to make any false or misleading statements to a credit reporting agency or a creditor;</li>
        <li>Advising you to alter your identity to change your credit record.</li>
      </ul>

      <p>
        <strong>(C) YOU HAVE THE RIGHT TO CANCEL YOUR CONTRACT WITH ANY CREDIT REPAIR ORGANIZATION FOR ANY
        REASON WITHIN 3 BUSINESS DAYS FROM THE DATE YOU SIGNED IT.</strong>{' '}
        To cancel, you must send a written notice of cancellation by email or certified mail. If you cancel
        within this 3-day period, any fees paid will be refunded in full within 10 business days where
        required by law.
      </p>

      <p>
        This statement is provided as required by the federal Credit Repair Organizations Act
        (15 U.S.C. § 1679c).
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">How Fieldwork fits</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>You remain free to dispute directly with bureaus and furnishers at no charge under the FCRA.</li>
        <li>Fieldwork does not advise you to lie, invent identity theft, or alter your identity.</li>
        <li>Fieldwork does not guarantee deletions or score increases.</li>
        <li>You review and authorize letters; you are the sender of record.</li>
        <li>
          Related policies:{' '}
          <Link to="/terms" className="font-semibold text-[var(--fw-sea)] hover:underline">Terms</Link>
          {' · '}
          <Link to="/privacy" className="font-semibold text-[var(--fw-sea)] hover:underline">Privacy</Link>
          {' · '}
          <Link to="/contact" className="font-semibold text-[var(--fw-sea)] hover:underline">Contact</Link>
        </li>
      </ul>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">Cancellation / notices</h2>
      <p>
        For cancellation or CROA-related notices regarding Fieldwork, write to{' '}
        <span className="fw-mono text-sm">legal@fieldwork.app</span> or use the{' '}
        <Link to="/contact" className="font-semibold text-[var(--fw-sea)] hover:underline">Contact</Link> form
        and keep a copy for your records. Certified mail address for production will be listed on your
        customer agreement when live billing is enabled.
      </p>

      <p className="!mt-12 text-sm text-[var(--fw-muted)]">
        This disclosure page is provided for compliance readiness in the Fieldwork product demo. Have counsel
        review packaging, contracts, and fee timing before launch.
      </p>
    </LegalShell>
  );
}
