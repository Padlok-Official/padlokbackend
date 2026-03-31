import brevo from "../../config/brevoConfig";

/**
 * Send email using the configured email provider
 */
export async function sendEmail(options: {
    from?: string;
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    cc?: string | string[];
    bcc?: string | string[];
}): Promise<{ data: any; error: { message: string } | null }> {
    return brevo.emails.send(options);
}
