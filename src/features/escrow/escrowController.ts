import { Response, NextFunction } from "express";
import { AuthenticatedRequest, WalletRequest } from "../../types";
import { escrowService } from "./escrowService";
import { ok, paginated, getRequestMeta } from "../../utils/respond";

export const initiateEscrow = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const { seller_email, item_title, item_description, item_photos, price } =
      req.body;
    const data = await escrowService.initiateEscrow({
      buyerId: req.user!.id,
      buyerName: req.user!.name,
      buyerWallet: req.wallet!,
      sellerEmail: seller_email,
      itemTitle: item_title,
      itemDescription: item_description,
      itemPhotos: item_photos,
      price: Number(price),
      meta: getRequestMeta(req),
    });
    return ok(
      res,
      data,
      "Escrow transaction initiated. Awaiting seller to set delivery window.",
      201,
    );
  } catch (err) {
    next(err);
  }
};

export const setDeliveryAndFund = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const data = await escrowService.setDeliveryAndFund({
      userId: req.user!.id,
      escrowId: req.params.id,
      deliveryHours: req.body.delivery_hours,
      meta: getRequestMeta(req),
    });
    return ok(
      res,
      data,
      `Delivery window set to ${data.delivery_window}. Funds locked in escrow. Countdown started.`,
    );
  } catch (err) {
    next(err);
  }
};

export const confirmDelivery = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const data = await escrowService.confirmDelivery({
      userId: req.user!.id,
      escrowId: req.params.id,
      meta: getRequestMeta(req),
    });
    return ok(
      res,
      data,
      "Delivery confirmed. Buyer can now confirm receipt or raise a dispute.",
    );
  } catch (err) {
    next(err);
  }
};

export const confirmReceipt = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    await escrowService.confirmReceipt({
      userId: req.user!.id,
      escrowId: req.params.id,
      meta: getRequestMeta(req),
    });
    return ok(res, undefined, "Receipt confirmed. Funds released to seller.");
  } catch (err) {
    next(err);
  }
};

export const raiseDispute = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const data = await escrowService.raiseDispute({
      userId: req.user!.id,
      userName: req.user!.name,
      escrowId: req.params.id,
      reason: req.body.reason,
      evidencePhotos: req.body.evidence_photos,
      meta: getRequestMeta(req),
    });
    return ok(
      res,
      data,
      "Dispute raised successfully. An admin will review your case.",
      201,
    );
  } catch (err) {
    next(err);
  }
};

export const cancelEscrow = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    await escrowService.cancelEscrow({
      userId: req.user!.id,
      escrowId: req.params.id,
      meta: getRequestMeta(req),
    });
    return ok(res, undefined, "Escrow transaction cancelled");
  } catch (err) {
    next(err);
  }
};

export const getEscrowTransactions = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const result = await escrowService.getEscrowTransactions(
      req.user!.id,
      req.query as Record<string, unknown>,
    );
    return paginated(
      res,
      "transactions",
      result.transactions,
      result.total,
      result.page,
      result.limit,
    );
  } catch (err) {
    next(err);
  }
};

export const getEscrowById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const data = await escrowService.getEscrowById(req.user!.id, req.params.id);
    return ok(res, data);
  } catch (err) {
    next(err);
  }
};

export const resolveDispute = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const { resolution, admin_notes } = req.body;
    const data = await escrowService.resolveDispute({
      adminId: req.user!.id,
      disputeId: req.params.id,
      resolution,
      adminNotes: admin_notes,
      meta: getRequestMeta(req),
    });
    return ok(
      res,
      undefined,
      `Dispute resolved. Funds ${data.resolution === "refund" ? "refunded to buyer" : "released to seller"}.`,
    );
  } catch (err) {
    next(err);
  }
};

export const getDisputes = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const result = await escrowService.getDisputes(
      req.query as Record<string, unknown>,
    );
    return paginated(
      res,
      "disputes",
      result.disputes,
      result.total,
      result.page,
      result.limit,
    );
  } catch (err) {
    next(err);
  }
};

export const uploadItemImages = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const urls = await escrowService.uploadItemImages(req.body.images);
    return ok(res, { urls }, "Images uploaded successfully");
  } catch (err) {
    next(err);
  }
};
