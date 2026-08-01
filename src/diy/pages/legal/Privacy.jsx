import { Link } from 'react-router-dom';
import { LegalShell } from '../../components/SiteChrome';

export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy" eyebrow="Legal · Effective August 1, 2026">
      <p className="text-sm text-[var(--fw-muted)]">
        This Privacy Policy explains how Fieldwork (“we,” “us”) collects, uses, and shares information when
        you use our website and software. Credit-related data is sensitive; we design the Service to minimize
        access and retain only what is needed to operate your account.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">1. Information we collect</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          <strong>Account data:</strong> name, email, password (hashed), billing address, plan selection.
        </li>
        <li>
          <strong>Identity / mailing data:</strong> consumer address used as return address on letters; government ID and proof of address you upload as enclosures.
        </li>
        <li>
          <strong>Credit-related data:</strong> credit reports or exports you upload; audit outputs; letter content; mail tracking metadata; furnisher response files you choose to upload.
        </li>
        <li>
          <strong>Payment data:</strong> processed by our payment processor (e.g., Stripe). We do not store full card numbers on Fieldwork servers.
        </li>
        <li>
          <strong>Technical data:</strong> IP address, device/browser type, approximate location, logs, and cookies or similar technologies needed for security and session management.
        </li>
      </ul>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">2. How we use information</h2>
      <ul className="list-disc space-y-2 pl-5">
        <li>Provide audits, letter drafting, mail fulfillment, tracking, and customer support;</li>
        <li>Process subscriptions, credits, and invoices;</li>
        <li>Secure the Service, prevent fraud and abuse, and comply with law;</li>
        <li>Improve product quality (preferably with aggregated or de-identified signals);</li>
        <li>Send transactional messages (receipts, delivery notices, security alerts).</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal information. We do not use your credit report to market
        unrelated third-party credit products without a separate, clear consent.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">3. AI processing</h2>
      <p>
        Audit and letter features may use third-party AI processors under contract to analyze report text you
        upload and to draft dispute language you review. Providers are instructed to process data to provide
        the Service and not to use it to train public models where the vendor contract allows that restriction.
        Do not upload information you are not authorized to process.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">4. Mail fulfillment</h2>
      <p>
        When you send certified mail, we share necessary name, address, letter content, and enclosure images
        with our print-and-mail provider (e.g., Lob) to fulfill your request. Tracking events may be stored
        in your account.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">5. Sharing</h2>
      <p>We share information with:</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Service providers under written agreements (hosting, auth, payments, email, AI, mail);</li>
        <li>Authorities when required by law or to protect rights, safety, and security;</li>
        <li>Successors in a merger or acquisition, subject to this Policy or equivalent protections.</li>
      </ul>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">6. Retention</h2>
      <p>
        We retain account and campaign records for as long as your account is active and for a limited period
        afterward for legal, tax, dispute, and security purposes. You may request deletion of your account;
        some records may be retained where law requires (for example, billing records).
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">7. Security</h2>
      <p>
        We use industry-standard safeguards such as encryption in transit, access controls, and least-privilege
        server credentials. No method of transmission or storage is 100% secure. Protect your password and
        device.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">8. Your choices and rights</h2>
      <p>
        Depending on your location (including certain U.S. state privacy laws), you may have rights to access,
        correct, delete, or export personal information, or to opt out of certain processing. To exercise
        rights, use{' '}
        <Link to="/contact" className="font-semibold text-[var(--fw-sea)] hover:underline">Contact</Link>
        {' '}or email <span className="fw-mono text-sm">privacy@fieldwork.app</span>. We will not discriminate
        against you for exercising privacy rights.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">9. Children</h2>
      <p>
        The Service is not directed to children under 18. We do not knowingly collect personal information
        from children.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">10. International users</h2>
      <p>
        The Service is operated from the United States. If you access it from elsewhere, you consent to
        processing in the U.S., where laws may differ from those in your country.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">11. Changes</h2>
      <p>
        We may update this Policy by posting a new version with a revised effective date. Material changes
        will be called out in-product or by email when appropriate.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">12. Contact</h2>
      <p>
        Privacy questions: <span className="fw-mono text-sm">privacy@fieldwork.app</span> ·{' '}
        <Link to="/contact" className="font-semibold text-[var(--fw-sea)] hover:underline">Contact form</Link>.
      </p>

      <p className="!mt-12 text-sm text-[var(--fw-muted)]">
        This Policy is a compliance-oriented template for the Fieldwork demo and should be reviewed by counsel
        before production use.
      </p>
    </LegalShell>
  );
}
