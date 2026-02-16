export interface IOTP {
    id: string;
    email: string;
    otp: string;
    expiresAt: Date;
    verified: boolean;
    attempts: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateOTPData {
    email: string;
    otp: string;
    expiresAt: Date;
    verified?: boolean;
    attempts?: number;
}
