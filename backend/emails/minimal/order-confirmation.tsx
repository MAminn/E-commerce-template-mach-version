import {
  Body,
  Container,
  Column,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
// NEVER REMOVE THIS IMPORT
import * as React from "react";
import type { OrderEmailNotice } from "../order-email-notice";

/**
 * The ONE order email template (customer confirmation + store notification).
 * Every brand value comes from props — resolved from the store's own layout
 * settings and env (backend/emails/branding.ts) — so no other store's name,
 * address or domain can ever appear in it. (The old second template
 * hard-coded "Lebsy" / support@lebsy.com and was what every store whose
 * navbar is not "minimal" — MACH included — actually sent.)
 */

export interface OrderEmailLine {
  name: string;
  quantity: number;
  /** What one unit cost the customer (after product discount). */
  unitPrice: number;
  /** Shown struck through when higher than unitPrice. */
  listUnitPrice?: number;
  lineTotal: number;
  /** BOGO / offer gift: printed as "Free". */
  isFreeGift?: boolean;
}

export interface OrderEmailTemplateProps {
  storeName: string;
  logoUrl?: string;
  supportEmail?: string;
  websiteUrl?: string;
  currency: string;
  orderNumber: string;
  /** Already formatted for display, e.g. "20 Nov 2026". */
  orderDate: string;
  paymentMethodLabel: string;
  items: OrderEmailLine[];
  subTotal: number;
  discount: number;
  promoCode?: string;
  shippingFees: number;
  total: number;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** Replaces the confirmation copy (e.g. paid order under review / admin hold). */
  notice?: OrderEmailNotice;
  /** "admin" adds a short header line for the store; the body is identical. */
  audience?: "customer" | "admin";
}

export const OrderConfirmationEmailTemplate = ({
  storeName,
  logoUrl,
  supportEmail,
  websiteUrl,
  currency,
  orderNumber,
  orderDate,
  paymentMethodLabel,
  items,
  subTotal,
  discount,
  promoCode,
  shippingFees,
  total,
  address,
  city,
  state,
  postalCode,
  country,
  customerName,
  customerEmail,
  customerPhone,
  notice,
  audience = "customer",
}: OrderEmailTemplateProps) => {
  const fmt = (price: number) => `${price.toFixed(2)} ${currency}`;
  const title = notice ? notice.title : "Order Confirmation";
  const preview = notice
    ? notice.preview
    : audience === "admin"
      ? `New order ${orderNumber} — ${fmt(total)}`
      : `Thank you for your order ${orderNumber} at ${storeName}.`;

  return (
    <Html>
      <Head>
        <title>{title}</title>
      </Head>
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            {logoUrl ? (
              <Img
                src={logoUrl}
                alt={storeName}
                height="48"
                style={{ margin: "0 auto", display: "block", objectFit: "contain", maxWidth: "200px" }}
              />
            ) : (
              <Heading as="h1" style={logoText}>
                {storeName}
              </Heading>
            )}
          </Section>

          <Hr style={divider} />

          {/* Greeting / notice */}
          <Section style={section}>
            {notice?.alert && notice.alert.length > 0 && (
              <Section style={noticeAlert}>
                {notice.alert.map((line) => (
                  <Text key={line} style={noticeAlertText}>
                    {line}
                  </Text>
                ))}
              </Section>
            )}
            <Heading as="h2" style={sectionTitle}>
              {title}
            </Heading>
            {audience === "admin" && !notice && (
              <Text style={paragraph}>A new order was placed on {storeName}.</Text>
            )}
            <Text style={paragraph}>Dear {customerName},</Text>
            {notice ? (
              notice.paragraphs.map((line) => (
                <Text key={line} style={paragraph}>
                  {line}
                </Text>
              ))
            ) : (
              <Text style={paragraph}>
                Thank you for your purchase at {storeName}. We&apos;ve received your order and
                will keep you updated on its status.
              </Text>
            )}
          </Section>

          {/* Order facts */}
          <Section style={factsWrap}>
            <Section style={factsBox}>
            <Row>
              <Column style={factLabel}>Order number</Column>
              <Column style={factValue}>{orderNumber}</Column>
            </Row>
            <Row>
              <Column style={factLabel}>Order date</Column>
              <Column style={factValue}>{orderDate}</Column>
            </Row>
            <Row>
              <Column style={factLabel}>Payment</Column>
              <Column style={factValue}>{paymentMethodLabel}</Column>
            </Row>
            </Section>
          </Section>

          {/* Order Summary */}
          <Section style={section}>
            <Heading as="h3" style={sectionTitle}>
              Order Summary
            </Heading>
            <Row style={tableHeaderRow}>
              <Column style={tableHeaderCellItem}>Item</Column>
              <Column style={tableHeaderCellCenter}>Qty</Column>
              <Column style={tableHeaderCellRight}>Price</Column>
            </Row>

            {items.map((item, index) => (
              <Row key={`${index}-${item.name}`} style={tableRow}>
                <Column style={tableCellItem}>
                  {item.name}
                  {item.isFreeGift ? <span style={giftTag}> · Gift</span> : null}
                </Column>
                <Column style={tableCellCenter}>{item.quantity}</Column>
                <Column style={tableCellRight}>
                  {item.isFreeGift ? (
                    <span style={{ color: "#15803d", fontWeight: 600 }}>Free</span>
                  ) : (
                    <>
                      {item.listUnitPrice !== undefined && item.listUnitPrice > item.unitPrice ? (
                        <>
                          <span style={{ textDecoration: "line-through", color: "#999" }}>
                            {fmt(item.listUnitPrice * item.quantity)}
                          </span>
                          <br />
                        </>
                      ) : null}
                      {fmt(item.lineTotal)}
                      {item.quantity > 1 ? (
                        <>
                          <br />
                          <span style={unitNote}>{fmt(item.unitPrice)} each</span>
                        </>
                      ) : null}
                    </>
                  )}
                </Column>
              </Row>
            ))}

            <Row>
              <Column style={summaryLabel}>
                Subtotal
              </Column>
              <Column style={summaryValue}>{fmt(subTotal)}</Column>
            </Row>
            {discount > 0 ? (
              <Row>
                <Column style={summaryLabel}>
                  Discount{promoCode ? ` (${promoCode})` : ""}
                </Column>
                <Column style={summaryValue}>−{fmt(discount)}</Column>
              </Row>
            ) : null}
            <Row>
              <Column style={summaryLabel}>
                Shipping
              </Column>
              <Column style={summaryValue}>{shippingFees > 0 ? fmt(shippingFees) : "Free"}</Column>
            </Row>
            <Row style={totalRow}>
              <Column style={totalLabel}>
                Total
              </Column>
              <Column style={totalValue}>{fmt(total)}</Column>
            </Row>
          </Section>

          {/* Shipping Address */}
          <Section style={section}>
            <Heading as="h3" style={sectionTitle}>
              Shipping Address
            </Heading>
            <Text style={infoText}>
              {customerName}
              <br />
              {address}
              <br />
              {[city, state, postalCode].filter((part) => part?.trim()).join(", ")}
              {country ? (
                <>
                  <br />
                  {country}
                </>
              ) : null}
            </Text>
          </Section>

          {/* Contact */}
          <Section style={section}>
            <Heading as="h3" style={sectionTitle}>
              Contact Details
            </Heading>
            <Text style={infoText}>
              {customerEmail}
              <br />
              {customerPhone}
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footer}>
            {supportEmail ? (
              <Text style={footerText}>
                Questions about your order? Reply to this email or contact us at{" "}
                <Link href={`mailto:${supportEmail}`} style={link}>
                  {supportEmail}
                </Link>
                .
              </Text>
            ) : (
              <Text style={footerText}>Questions about your order? Just reply to this email.</Text>
            )}
            {websiteUrl ? (
              <Text style={footerText}>
                <Link href={websiteUrl} style={link}>
                  {websiteUrl.replace(/^https?:\/\//, "")}
                </Link>
              </Text>
            ) : null}
            <Text style={footerText}>
              &copy; {new Date().getFullYear()} {storeName}. All rights reserved.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const noticeAlert = {
  backgroundColor: "#fef2f2",
  border: "2px solid #dc2626",
  padding: "12px 16px",
  marginBottom: "16px",
};

const noticeAlertText = {
  color: "#991b1b",
  fontSize: "14px",
  fontWeight: "700",
  margin: "2px 0",
};

const main = {
  backgroundColor: "#f9fafb",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  padding: "24px 0",
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "600px",
  border: "1px solid #e5e7eb",
};

const header = {
  padding: "32px 24px 24px",
  textAlign: "center" as const,
};

const logoText = {
  fontSize: "26px",
  fontWeight: "700",
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: "#111111",
  margin: "0",
  textAlign: "center" as const,
};

const divider = {
  borderTop: "1px solid #e5e7eb",
  margin: "0",
};

const section = {
  padding: "20px 24px",
};

const factsWrap = {
  padding: "0 24px",
};

const factsBox = {
  padding: "12px 16px",
  backgroundColor: "#f5f5f4",
};

const factLabel = {
  fontSize: "13px",
  color: "#78716c",
  padding: "3px 0",
  width: "40%",
};

const factValue = {
  fontSize: "13px",
  color: "#1c1917",
  fontWeight: "600",
  padding: "3px 0",
  textAlign: "right" as const,
};

const sectionTitle = {
  fontSize: "15px",
  fontWeight: "600",
  color: "#1c1917",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  margin: "0 0 12px",
};

const paragraph = {
  fontSize: "14px",
  lineHeight: "22px",
  color: "#44403c",
  margin: "8px 0",
};

const tableHeaderRow = {
  borderBottom: "2px solid #e5e7eb",
};

const tableHeaderCell = {
  fontSize: "11px",
  fontWeight: "600",
  color: "#78716c",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  padding: "8px 4px",
  textAlign: "left" as const,
};

const COL_ITEM = "58%";
const COL_QTY = "12%";
const COL_PRICE = "30%";

const tableHeaderCellItem = { ...tableHeaderCell, width: COL_ITEM };
const tableHeaderCellCenter = { ...tableHeaderCell, textAlign: "center" as const, width: COL_QTY };
const tableHeaderCellRight = { ...tableHeaderCell, textAlign: "right" as const, width: COL_PRICE };

const tableRow = {
  borderBottom: "1px solid #f5f5f4",
};

const tableCell = {
  fontSize: "14px",
  color: "#1c1917",
  padding: "10px 4px",
  textAlign: "left" as const,
  verticalAlign: "top" as const,
};

const tableCellItem = { ...tableCell, width: COL_ITEM };
const tableCellCenter = { ...tableCell, textAlign: "center" as const, width: COL_QTY };
const tableCellRight = { ...tableCell, textAlign: "right" as const, width: COL_PRICE };

const giftTag = { color: "#15803d", fontSize: "12px", fontWeight: "600" };
const unitNote = { color: "#a8a29e", fontSize: "11px" };

const summaryLabel = {
  width: "70%",
  fontSize: "13px",
  padding: "6px 4px",
  textAlign: "right" as const,
  color: "#78716c",
};

const summaryValue = {
  fontSize: "13px",
  padding: "6px 4px",
  textAlign: "right" as const,
  color: "#1c1917",
};

const totalRow = {
  borderTop: "2px solid #1c1917",
};

const totalLabel = {
  width: "70%",
  fontSize: "15px",
  fontWeight: "700",
  padding: "12px 4px",
  textAlign: "right" as const,
  color: "#1c1917",
};

const totalValue = {
  fontSize: "15px",
  fontWeight: "700",
  padding: "12px 4px",
  textAlign: "right" as const,
  color: "#1c1917",
};

const infoText = {
  fontSize: "14px",
  lineHeight: "22px",
  color: "#44403c",
  margin: "0",
};

const footer = {
  padding: "20px 24px",
  textAlign: "center" as const,
};

const footerText = {
  fontSize: "12px",
  color: "#a8a29e",
  margin: "4px 0",
};

const link = {
  color: "#1c1917",
  textDecoration: "underline",
};
