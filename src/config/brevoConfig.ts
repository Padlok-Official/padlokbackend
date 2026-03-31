import logger from '../utils/logger';
import dotenv from "dotenv";
import axios from "axios";

// Load environment variables
dotenv.config();

// Get API key from environment
const apiKey = process.env.BREVO_API_KEY;

// Brevo API endpoint
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

// Default sender configuration
const DEFAULT_SENDER = {
    name: process.env.BREVO_SENDER_NAME || "Padlok",
    email: process.env.BREVO_SENDER_EMAIL || "noreply@padlok.com",
};

interface SendEmailOptions {
    from?: string;
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    cc?: string | string[];
    bcc?: string | string[];
}

interface BrevoRecipient {
    email: string;
    name?: string;
}

interface BrevoEmailResponse {
    messageId?: string;
    error?: {
        message: string;
    };
}

/**
 * Send email using Brevo API
 */
async function sendEmail(options: SendEmailOptions): Promise<{
    data: BrevoEmailResponse | null;
    error: { message: string } | null;
}> {
    if (!apiKey) {
        logger.error(
            "Brevo is not initialized. Please set BREVO_API_KEY in your environment variables."
        );
        return {
            data: null,
            error: {
                message: "Email service is not configured. BREVO_API_KEY is missing.",
            },
        };
    }

    try {
        // Parse sender email and name from "from" field
        let senderEmail = DEFAULT_SENDER.email;
        let senderName = DEFAULT_SENDER.name;

        if (options.from) {
            const fromMatch = options.from.match(/^(.+?)\s*<(.+?)>$|^(.+?)$/);
            if (fromMatch) {
                if (fromMatch[2]) {
                    senderName = fromMatch[1]?.trim() || DEFAULT_SENDER.name;
                    senderEmail = fromMatch[2]?.trim() || DEFAULT_SENDER.email;
                } else {
                    senderEmail = (fromMatch[3] || fromMatch[0] || DEFAULT_SENDER.email).trim();
                }
            }
        }

        // Parse recipients
        const toRecipients: BrevoRecipient[] = [];
        const toArray = Array.isArray(options.to) ? options.to : [options.to];

        for (const recipient of toArray) {
            const recipientMatch = recipient.match(/^(.+?)\s*<(.+?)>$|^(.+?)$/);
            if (recipientMatch) {
                if (recipientMatch[2]) {
                    const recipientObj: BrevoRecipient = {
                        email: recipientMatch[2]?.trim() || recipient,
                    };
                    const name = recipientMatch[1]?.trim();
                    if (name) {
                        recipientObj.name = name;
                    }
                    toRecipients.push(recipientObj);
                } else {
                    toRecipients.push({
                        email: (recipientMatch[3] || recipientMatch[0] || recipient).trim(),
                    });
                }
            } else {
                toRecipients.push({ email: recipient.trim() });
            }
        }

        // Prepare Brevo API payload
        const payload: any = {
            sender: {
                name: senderName,
                email: senderEmail,
            },
            to: toRecipients,
            subject: options.subject,
            htmlContent: options.html || options.text || "",
        };

        if (options.text) {
            payload.textContent = options.text;
        }

        // Make API request to Brevo
        const response = await axios.post(BREVO_API_URL, payload, {
            headers: {
                accept: "application/json",
                "api-key": apiKey,
                "content-type": "application/json",
            },
        });

        return {
            data: {
                messageId: response.data.messageId || response.data.id,
            },
            error: null,
        };
    } catch (error: any) {
        logger.error("Error sending email via Brevo:", error);
        return {
            data: null,
            error: {
                message:
                    error.response?.data?.message ||
                    error.message ||
                    "Failed to send email via Brevo",
            },
        };
    }
}

export default {
    emails: {
        send: sendEmail,
    },
};
