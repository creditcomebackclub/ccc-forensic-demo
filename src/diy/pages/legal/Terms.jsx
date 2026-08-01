import { Link } from 'react-router-dom';
import { LegalShell } from '../../components/SiteChrome';

export default function Terms() {
  return (
    <LegalShell title="Terms of Service" eyebrow="Legal · Effective August 1, 2026">
      <p className="text-sm text-[var(--fw-muted)]">
        These Terms govern access to and use of the Fieldwork website, demo, and subscription software
        (the “Service”). By creating an account or using the Service, you agree to these Terms.
        If you do not agree, do not use the Service.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">1. Who we are</h2>
      <p>
        Fieldwork is a software product that helps consumers review credit-report information and prepare
        and send consumer disputes. For notices under these Terms, contact{' '}
        <Link to="/contact" className="font-semibold text-[var(--fw-sea)] hover:underline">Contact</Link>
        {' '}or email <span className="fw-mono text-sm">legal@fieldwork.app</span> (demo address).
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">2. Not legal advice; no guarantees</h2>
      <p>
        The Service provides software tools and educational information. It does <strong>not</strong> provide
        legal advice, legal representation, or credit counseling. Nothing in the Service guarantees deletion
        of any item, any credit-score increase, loan approval, or any particular outcome. Accurate negative
        information may lawfully remain on a consumer report.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">3. You are the decision-maker and sender</h2>
      <p>
        You choose which items to dispute, approve letter content before mailing, and remain the sender of
        record on correspondence generated through the Service. You are solely responsible for the accuracy
        and lawfulness of information you submit and statements you authorize us to transmit on your behalf
        as a mail fulfillment conduit.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">4. Eligibility</h2>
      <p>
        You must be at least 18 years old and able to form a binding contract. The Service is intended for
        individuals acting on their own consumer credit files (or as a lawful guardian/authorized representative
        where permitted by law). You may not use the Service to generate false statements to a consumer
        reporting agency or furnisher.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">5. Accounts and security</h2>
      <p>
        You are responsible for maintaining the confidentiality of your login credentials and for activity
        under your account. Notify us promptly of unauthorized use. We may suspend or terminate accounts that
        violate these Terms or create security, fraud, or abuse risk.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">6. Subscriptions, credits, and billing</h2>
      <p>
        Paid plans, mail credits, and fees are described at checkout and on the pricing page. Unless required
        by law, fees are non-refundable once a billing period begins, except where a promotion or statutory
        right (including any applicable cancellation right) says otherwise. One mail credit equals one
        certified mail packet fulfilled through our print-mail provider (typically about $12–$15 of provider
        cost with enclosures). Phase 1 packets include the dispute letter and identity documents; Phase 2
        packets may also include furnisher responses, return receipts, and prior letters. Credits may expire
        as disclosed in-product. Demo mode does not charge a card.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">7. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Submit false, fraudulent, or misleading dispute content;</li>
        <li>Attempt to reverse engineer, abuse, or overload the Service;</li>
        <li>Use the Service for anyone else’s file without lawful authority;</li>
        <li>Upload malware or infringing content;</li>
        <li>Resell access without our written consent.</li>
      </ul>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">8. Consumer rights notice</h2>
      <p>
        Important consumer rights under the Credit Repair Organizations Act are summarized in our{' '}
        <Link to="/croa" className="font-semibold text-[var(--fw-sea)] hover:underline">
          Statement of Consumer Rights (CROA)
        </Link>
        . You also have rights under the Fair Credit Reporting Act to dispute inaccurate information directly
        with consumer reporting agencies and furnishers at no charge.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">9. Intellectual property</h2>
      <p>
        Fieldwork, its logos, software, and content are owned by us or our licensors. You receive a limited,
        non-exclusive, non-transferable license to use the Service for your personal consumer purposes while
        subscribed. You retain ownership of documents and data you upload; you grant us a limited license to
        process them solely to operate the Service.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">10. Privacy</h2>
      <p>
        Our collection and use of personal information is described in the{' '}
        <Link to="/privacy" className="font-semibold text-[var(--fw-sea)] hover:underline">Privacy Policy</Link>.
        Credit reports and identity documents are sensitive; handle account access carefully.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">11. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE
        DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR
        PURPOSE, AND NON-INFRINGEMENT. We do not warrant uninterrupted or error-free operation, or that
        audits or letters will identify every issue or produce any result.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">12. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, FIELDWORK AND ITS OPERATORS WILL NOT BE LIABLE FOR INDIRECT,
        INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, CREDIT DENIALS, OR
        SCORE CHANGES. OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE WILL NOT EXCEED THE AMOUNTS
        YOU PAID TO US FOR THE SERVICE IN THE THREE (3) MONTHS BEFORE THE CLAIM.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">13. Indemnity</h2>
      <p>
        You will defend and indemnify Fieldwork against claims arising from your content, your disputes,
        your misuse of the Service, or your violation of law or these Terms.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">14. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate access for violations,
        non-payment, or risk to the platform. Provisions that by nature should survive (including
        disclaimers, liability limits, and indemnity) will survive termination.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">15. Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of Colorado, excluding conflict-of-law rules,
        unless mandatory consumer protections in your state of residence require otherwise. Venue for
        disputes will be in state or federal courts located in Colorado, subject to applicable consumer rights.
      </p>

      <h2 className="fw-display !mt-10 text-2xl font-bold text-[var(--fw-ink)]">16. Changes</h2>
      <p>
        We may update these Terms by posting a revised version with a new effective date. Material changes
        will be highlighted in-product or by email when appropriate. Continued use after the effective date
        constitutes acceptance.
      </p>

      <p className="!mt-12 text-sm text-[var(--fw-muted)]">
        These Terms are a product template for the Fieldwork demo and should be reviewed by counsel before
        production use.
      </p>
    </LegalShell>
  );
}
