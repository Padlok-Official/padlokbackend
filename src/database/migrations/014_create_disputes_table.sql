-- Create disputes table for escrow dispute resolution
CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_transaction_id UUID NOT NULL REFERENCES escrow_transactions(id),
  raised_by UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  evidence_photos TEXT[] DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved_refund', 'resolved_release', 'closed')),
  admin_id UUID REFERENCES users(id),
  admin_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_disputes_escrow_id ON disputes(escrow_transaction_id);
CREATE INDEX idx_disputes_raised_by ON disputes(raised_by);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_created_at ON disputes(created_at);

CREATE TRIGGER update_disputes_updated_at
  BEFORE UPDATE ON disputes
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();
