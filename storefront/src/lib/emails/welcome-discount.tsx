import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "react-email";
import { getStoreName, getStoreUrl } from "@/lib/store";

interface WelcomeDiscountEmailProps {
  firstName?: string | null;
  code: string;
  percent: number;
  expiresAt: Date;
  storeName?: string;
  storeUrl?: string;
}

export function WelcomeDiscountEmail({
  firstName,
  code,
  percent,
  expiresAt,
  storeName = getStoreName(),
  storeUrl = getStoreUrl(),
}: WelcomeDiscountEmailProps) {
  const expiry = expiresAt.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Html>
      <Head />
      <Preview>
        {`${percent}% off your first ${storeName} order: ${code}`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>
            Welcome{firstName ? `, ${firstName}` : ""}.
          </Heading>
          <Text style={paragraph}>
            Thanks for joining {storeName}. Here's {percent}% off your first
            order. Enter this code at checkout:
          </Text>

          <Section style={codeBox}>
            <Text style={codeText}>{code}</Text>
          </Section>

          {storeUrl && (
            <Section style={buttonSection}>
              <Button href={storeUrl} style={button}>
                Shop now
              </Button>
            </Section>
          )}

          <Hr style={hr} />
          <Text style={disclaimer}>
            Single use, valid on your first order only, for the account this was
            sent to. Expires {expiry}.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const navy = "#0B1F3A";
const orange = "#FF6B1A";

const main = {
  backgroundColor: "#f4f6f9",
  fontFamily: "Inter, Arial, sans-serif",
};
const container = {
  margin: "0 auto",
  padding: "40px 24px",
  maxWidth: "560px",
  backgroundColor: "#ffffff",
};
const heading = {
  color: navy,
  fontSize: "26px",
  fontWeight: 700,
  margin: "0 0 16px",
};
const paragraph = { color: "#334155", fontSize: "15px", lineHeight: "24px" };
const codeBox = {
  border: `2px dashed ${orange}`,
  borderRadius: "8px",
  padding: "16px",
  margin: "24px 0",
  textAlign: "center" as const,
};
const codeText = {
  color: navy,
  fontSize: "22px",
  fontWeight: 700,
  letterSpacing: "2px",
  margin: 0,
  fontFamily: "Menlo, monospace",
};
const buttonSection = { textAlign: "center" as const, margin: "24px 0" };
const button = {
  backgroundColor: orange,
  color: navy,
  padding: "12px 28px",
  borderRadius: "6px",
  fontWeight: 600,
  textDecoration: "none",
};
const hr = { borderColor: "#e2e8f0", margin: "24px 0" };
const disclaimer = { color: "#64748b", fontSize: "12px", lineHeight: "18px" };
