import { forwardRef, useEffect, useState } from "react";
import type { PosOrderResponse, RegisterResponse, StoreResponse, TicketResponse } from "@pako/shared";
import QRCode from "qrcode";
import { useIntl } from "react-intl";

import { AtkStatus, FiscalDocumentType, PosOrderKind, giftCardKindKey } from "@/lib/pos-enums";

export interface CouponIssuer {
  companyName: string;
  fiscalNumber?: string;
  vatNumber?: string;
}

const money = (v: number) => v.toFixed(2);

// docs/POS_PLAN.md §11.4: what the coupon must show (AI MF 01/2026 art. 9) — issuer, NUI, the
// lines with their VAT letter, VAT per rate, payments, coupon id and the verification QR.
// Every amount is the server's; nothing here is computed.
export const CouponReceipt = forwardRef<HTMLDivElement, {
  order: PosOrderResponse;
  store: StoreResponse;
  register: RegisterResponse;
  issuer: CouponIssuer;
}>(function CouponReceipt({ order, store, register, issuer }, ref) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const fiscal = order.fiscal;
  const training = fiscal?.type === FiscalDocumentType.Training;
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!fiscal?.qrCode) return;
    QRCode.toDataURL(fiscal.qrCode, { margin: 0, width: 168, errorCorrectionLevel: "M" })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [fiscal?.qrCode]);

  const title = order.kind === PosOrderKind.Return ? "coupon.type.return" : order.kind === PosOrderKind.Cancel ? "coupon.type.cancel" : "coupon.type.sale";

  return (
    <div
      ref={ref}
      className="mx-auto w-[72mm] bg-white p-2 font-mono text-[11px] leading-tight text-black"
      data-testid="coupon"
    >
      {training && <p className="mb-1 border border-black p-1 text-center font-bold">{t("coupon.training")}</p>}
      {store.receiptHeader && <p className="whitespace-pre-line text-center">{store.receiptHeader}</p>}
      <p className="text-center font-bold">{issuer.companyName}</p>
      {issuer.fiscalNumber && <p className="text-center">{t("coupon.nui")}: {issuer.fiscalNumber}</p>}
      {issuer.vatNumber && <p className="text-center">{t("coupon.vat")}: {issuer.vatNumber}</p>}
      <p className="text-center">{store.name}{store.address ? `, ${store.address}` : ""}</p>
      <p className="text-center">{store.location}</p>
      <hr className="my-1 border-dashed border-black" />
      <p className="text-center font-bold">{t(title)}</p>
      <div className="flex justify-between">
        <span>{order.number}</span>
        <span>{intl.formatDate(order.orderedAt)} {intl.formatTime(order.orderedAt)}</span>
      </div>
      <div className="flex justify-between">
        <span>{register.code}</span>
        <span>{t("coupon.operator")}: {order.operatorName}</span>
      </div>
      {fiscal?.referenceCouponId != null && <p>{t("coupon.reference", { id: fiscal.referenceCouponId })}</p>}
      <hr className="my-1 border-dashed border-black" />
      {order.lines.map((l) => (
        <div key={l.id} className="mb-0.5">
          <p>{l.description}</p>
          <div className="flex justify-between">
            <span>
              {intl.formatNumber(l.quantity, { maximumFractionDigits: 3 })} {l.unit} × {money(l.unitPrice)}
              {l.discountAmount > 0 && ` −${money(l.discountAmount)}`}
            </span>
            <span>{money(l.gross)} {l.taxLetter}</span>
          </div>
          {l.programName && <p className="pl-2 italic">{l.programName}</p>}
        </div>
      ))}
      <hr className="my-1 border-dashed border-black" />
      {order.totalDiscount > 0 && (
        <div className="flex justify-between">
          <span>{t("coupon.discount")}</span>
          <span>−{money(order.totalDiscount)}</span>
        </div>
      )}
      <div className="flex justify-between text-sm font-bold">
        <span>{t("coupon.total")}</span>
        <span>{money(order.total)} €</span>
      </div>
      <table className="mt-1 w-full">
        <thead>
          <tr>
            <th className="text-left font-normal" />
            <th className="text-right font-normal">{t("coupon.taxBase")}</th>
            <th className="text-right font-normal">{t("coupon.tax")}</th>
          </tr>
        </thead>
        <tbody>
          {(order.taxes ?? []).map((tx) => (
            <tr key={tx.taxLetter}>
              <td>{tx.taxLetter} {intl.formatNumber(tx.taxRate, { style: "percent", maximumFractionDigits: 2 })}</td>
              <td className="text-right">{money(tx.net)}</td>
              <td className="text-right">{money(tx.tax)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr className="my-1 border-dashed border-black" />
      {/* The payment line is the applied amount; cash handed over shows apart when it differs. */}
      {order.payments.map((p, i) => (
        <div key={i}>
          <div className="flex justify-between">
            <span>{p.name}</span>
            <span>{money(p.amount)}</span>
          </div>
          {p.tendered != null && p.tendered !== p.amount && (
            <div className="flex justify-between">
              <span>{t("coupon.cashGiven")}</span>
              <span>{money(p.tendered)}</span>
            </div>
          )}
        </div>
      ))}
      {order.change > 0 && (
        <div className="flex justify-between">
          <span>{t("till.pay.change")}</span>
          <span>{money(order.change)}</span>
        </div>
      )}
      {/* P2: gift cards and store credit loaded or spent, with the balance left on each. */}
      {(order.cards?.length ?? 0) > 0 && (
        <div data-testid="coupon-cards">
          <hr className="my-1 border-dashed border-black" />
          <p className="font-bold">{t("coupon.cards")}</p>
          {order.cards?.map((c, i) => (
            <div key={i} className="mb-0.5">
              <p>{t(`pos.giftCard.kind.${giftCardKindKey(c.kind)}`)} {c.number}</p>
              <div className="flex justify-between">
                <span>{t(c.change < 0 ? "coupon.card.spent" : "coupon.card.loaded")}</span>
                <span>{money(c.change)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t("coupon.card.balance")}</span>
                <span>{money(c.balance)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {((order.pointsEarned ?? 0) > 0 || (order.pointsRedeemed ?? 0) > 0 || order.pointsBalance != null) && (
        <div data-testid="coupon-loyalty">
          <hr className="my-1 border-dashed border-black" />
          <p className="font-bold">{t("coupon.loyalty")}</p>
          {(order.pointsEarned ?? 0) > 0 && (
            <div className="flex justify-between">
              <span>{t("coupon.points.earned")}</span>
              <span>{intl.formatNumber(order.pointsEarned ?? 0)}</span>
            </div>
          )}
          {(order.pointsRedeemed ?? 0) > 0 && (
            <div className="flex justify-between">
              <span>{t("coupon.points.redeemed")}</span>
              <span>{intl.formatNumber(order.pointsRedeemed ?? 0)}</span>
            </div>
          )}
          {order.pointsBalance != null && (
            <div className="flex justify-between">
              <span>{t("coupon.points.balance")}</span>
              <span>{intl.formatNumber(order.pointsBalance)}</span>
            </div>
          )}
        </div>
      )}
      {fiscal && (
        <>
          <hr className="my-1 border-dashed border-black" />
          <p>{t("coupon.id")}: {fiscal.couponId}</p>
          <p>{t("coupon.daily")}: {fiscal.dailyNumber}</p>
          <p>{t("coupon.verification")}: {fiscal.verificationNo}</p>
          {register.fiscalizationNumber && <p>EDI: {register.fiscalizationNumber}</p>}
          {qr && <img src={qr} alt="QR" className="mx-auto my-1 size-[42mm]" />}
          {!training && <p className="text-center">{t("coupon.verify")}</p>}
          {fiscal.atkStatus === AtkStatus.Pending && <p className="text-center font-bold">{t("coupon.offline")}</p>}
        </>
      )}
      {store.receiptFooter && <p className="mt-1 whitespace-pre-line text-center">{store.receiptFooter}</p>}
      {training && <p className="mt-1 border border-black p-1 text-center font-bold">{t("coupon.training")}</p>}
      {/* P5: each event ticket this sale issued prints after the coupon, one per page (the roll
          printer cuts between them), with its code as a QR the door scanner reads. */}
      {order.tickets?.map((ticket) => <TicketStub key={ticket.code} ticket={ticket} />)}
    </div>
  );
});

function TicketStub({ ticket }: { ticket: TicketResponse }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(ticket.code, { margin: 0, width: 168, errorCorrectionLevel: "M" })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [ticket.code]);
  return (
    <div className="mt-2 border-t-2 border-dashed border-black pt-2 text-center" style={{ breakBefore: "page" }} data-testid="coupon-ticket">
      <p className="text-[10px] uppercase">{t("hotel.ticket.coupon")}</p>
      <p className="text-sm font-bold">{ticket.eventName}</p>
      <p>
        {intl.formatDate(ticket.startsAt, { timeZone: "Europe/Belgrade", dateStyle: "medium" })}{" "}
        {intl.formatTime(ticket.startsAt, { timeZone: "Europe/Belgrade", timeStyle: "short" })}
      </p>
      <p className="font-bold">{ticket.ticketType}</p>
      {qr && <img src={qr} alt={ticket.code} className="mx-auto my-1 size-[38mm]" />}
      <p className="font-mono tracking-wider">{ticket.code}</p>
      <p className="text-[10px]">{t("hotel.ticket.coupon.once")}</p>
    </div>
  );
}
