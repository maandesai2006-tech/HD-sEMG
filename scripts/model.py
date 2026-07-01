"""
Models: CNN -> BiLSTM -> CTC phoneme decoder.

  SubvocalCTC   : plain baseline (CTC only).
  SubvocalCTCV2 : adds a 64-d projection head; a SupCon contrastive loss is
                  applied to those embeddings on CTC-forced-aligned frames so
                  that the SAME phoneme produced by DIFFERENT speakers is pulled
                  together in a subject-invariant space (the moat hypothesis).

Blank-logit bias is initialised negative to avoid the well-known all-blank CTC
collapse on short/limited data.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

N_FEAT = 160          # 40 ch * 4 features
N_PHONE = 39
N_CLASS = N_PHONE + 1  # + CTC blank (id 0)
BLANK = 0


class _Backbone(nn.Module):
    def __init__(self, in_feat=N_FEAT, hidden=256):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(in_feat, 128, 3, padding=1), nn.BatchNorm1d(128), nn.ReLU(),
            nn.Conv1d(128, 128, 3, padding=1), nn.BatchNorm1d(128), nn.ReLU(),
        )
        self.lstm = nn.LSTM(128, hidden, num_layers=2, batch_first=True,
                            dropout=0.3, bidirectional=True)
        self.out_dim = hidden * 2

    def forward(self, x):            # x: (B, T, F)
        h = self.conv(x.transpose(1, 2)).transpose(1, 2)   # (B, T, 128)
        h, _ = self.lstm(h)                                # (B, T, 512)
        return h


class SubvocalCTC(nn.Module):
    def __init__(self):
        super().__init__()
        self.backbone = _Backbone()
        self.head = nn.Linear(self.backbone.out_dim, N_CLASS)
        with torch.no_grad():
            self.head.bias[BLANK] = -3.0     # discourage all-blank collapse

    def forward(self, x):
        h = self.backbone(x)
        return F.log_softmax(self.head(h), dim=-1)   # (B, T, C)


class SubvocalCTCV2(nn.Module):
    def __init__(self, emb_dim=64):
        super().__init__()
        self.backbone = _Backbone()
        self.proj = nn.Sequential(
            nn.Linear(self.backbone.out_dim, 128), nn.ReLU(),
            nn.Linear(128, emb_dim))
        self.head = nn.Linear(emb_dim, N_CLASS)
        with torch.no_grad():
            self.head.bias[BLANK] = -3.0

    def forward(self, x):
        h = self.backbone(x)
        z = self.proj(h)                              # (B, T, emb)
        logp = F.log_softmax(self.head(z), dim=-1)    # (B, T, C)
        return logp, z


def supcon_loss(emb, labels, tau=0.07):
    """Supervised contrastive loss over a set of frame embeddings.
    emb: (M, d) L2-normalised inside; labels: (M,) phoneme ids (>0)."""
    if emb.shape[0] < 4:
        return emb.new_tensor(0.0)
    z = F.normalize(emb, dim=1)
    sim = z @ z.t() / tau                              # (M, M)
    M = z.shape[0]
    self_mask = torch.eye(M, dtype=torch.bool, device=z.device)
    sim.masked_fill_(self_mask, -1e9)
    logits = sim - sim.max(dim=1, keepdim=True).values.detach()
    exp = torch.exp(logits)
    denom = exp.sum(dim=1)                             # over all non-self
    pos = labels.unsqueeze(0) == labels.unsqueeze(1)
    pos.masked_fill_(self_mask, False)
    loss = 0.0
    n = 0
    log_prob = logits - torch.log(denom.unsqueeze(1) + 1e-12)
    for i in range(M):
        p = pos[i]
        if p.any():
            loss = loss - log_prob[i][p].mean()
            n += 1
    if n == 0:
        return emb.new_tensor(0.0)
    return loss / n
