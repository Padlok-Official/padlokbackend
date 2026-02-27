import { Request, Response } from "express";
import { WalletModel } from "../models";

export const getUserWallet = async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;
        const wallet = await WalletModel.findByUserId(userId);
        if (!wallet) {
            return res.status(404).json({
                success: false,
                message: 'Wallet not found',
            });
        }
        return res.status(200).json({
            success: true,
            data: wallet,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
}