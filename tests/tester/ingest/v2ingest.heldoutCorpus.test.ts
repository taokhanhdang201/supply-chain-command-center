// TESTER (Agent 3) independent held-out mapping corpus for v2-universal-ingestion, criterion 46.
// Written WITHOUT reading the dictionary files, the Coder's corpora/fixtures or the mapper tests. Only the public
// pipeline API (`analyzeFile`), the default registry and the canonical field names of src/shared/csv/schemas.ts are used.
// Ground truth below was fixed before the first run. Companies and data are invented.
//
// Truth values: a canonical field name, null (junk / distractor: must never be MATCHED), or 'AMBIG' (a genuinely
// ambiguous header: must never be MATCHED).

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ImportKind } from '../../../src/shared/types';
import { analyzeFile } from '../../../src/shared/ingest/pipeline';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';

type Truth = string | null | 'AMBIG';
type Lang = 'en' | 'vi' | 'es' | 'de' | 'fr';
type Vt =
  | 'sid' | 'city' | 'carrier' | 'status' | 'ship' | 'eta' | 'act' | 'money' | 'note' | 'person' | 'weight' | 'colour'
  | 'rating' | 'iid' | 'po' | 'customer' | 'incoterm' | 'sku' | 'product' | 'category' | 'wh' | 'qty' | 'rop' | 'lead'
  | 'adu' | 'bin' | 'created' | 'phone' | 'count' | 'scac' | 'ndc' | 'lot';

interface Col { h: string; truth: Truth; vt: Vt }
interface Company {
  name: string;
  lang: Lang;
  diacritics: boolean;
  kind: ImportKind;
  dates: 'iso' | 'dmy' | 'mdy' | 'dot';
  numbers: 'plain' | 'us' | 'eu' | 'fr';
  sep: 'comma' | 'semicolon' | 'tab';
  cols: Col[];
}

const c = (h: string, truth: Truth, vt: Vt): Col => ({ h, truth, vt });

// ------------------------------------------------------------------------------------------------------------------
// The corpus (18 invented companies)
// ------------------------------------------------------------------------------------------------------------------
export const COMPANIES: Company[] = [
  { name: 'Northwind Parcel Co.', lang: 'en', diacritics: true, kind: 'shipments', dates: 'mdy', numbers: 'us', sep: 'comma', cols: [
    c('Tracking #', 'shipment_id', 'sid'), c('Origin Hub', 'origin', 'city'), c('Dest. City', 'destination', 'city'), c('Courier', 'carrier', 'carrier'),
    c('Shipment Status', 'status', 'status'), c('Ship Dt', 'ship_date', 'ship'), c('ETA Date', 'estimated_delivery', 'eta'), c('Delivered Dt', 'actual_delivery', 'act'),
    c('Freight Cost ($)', 'shipping_cost', 'money'), c('Notes', null, 'note'), c('Last modified by', null, 'person'), c('Weight (lbs)', null, 'weight') ] },
  { name: 'Bluepeak Outdoor Supply', lang: 'en', diacritics: true, kind: 'inventory', dates: 'iso', numbers: 'plain', sep: 'comma', cols: [
    c('SKU#', 'sku', 'sku'), c('Item Description', 'product_name', 'product'), c('Product Category', 'category', 'category'), c('Warehouse Code', 'warehouse', 'wh'),
    c('Qty On Hand', 'quantity', 'qty'), c('Reorder Level', 'reorder_point', 'rop'), c('Unit Price (USD)', 'unit_cost', 'money'), c('Avg. Daily Sales', 'avg_daily_usage', 'adu'),
    c('Lead Time (days)', 'lead_time_days', 'lead'), c('Colour', null, 'colour'), c('Rating', null, 'rating'), c('Supplier', null, 'customer'), c('Internal ID', null, 'iid') ] },
  { name: 'Harborline Logistics', lang: 'en', diacritics: true, kind: 'shipments', dates: 'iso', numbers: 'plain', sep: 'comma', cols: [
    c('Consignment Ref', 'shipment_id', 'sid'), c('Ship From', 'origin', 'city'), c('Ship To', 'destination', 'city'), c('Carrier Name', 'carrier', 'carrier'),
    c('Current Status', 'status', 'status'), c('Dispatch Date', 'ship_date', 'ship'), c('Expected Delivery Date', 'estimated_delivery', 'eta'), c('Actual Delivery Date', 'actual_delivery', 'act'),
    c('Shipping Charges', 'shipping_cost', 'money'), c('Order Date', null, 'created'), c('Customer', null, 'customer'), c('Incoterms', null, 'incoterm'), c('PO Number', null, 'po') ] },
  { name: 'Cobalt Components Inc.', lang: 'en', diacritics: true, kind: 'inventory', dates: 'mdy', numbers: 'us', sep: 'comma', cols: [
    c('Item No.', 'sku', 'sku'), c('Item Name', 'product_name', 'product'), c('Item Group', 'category', 'category'), c('Location Code', 'warehouse', 'wh'),
    c('On-Hand Qty', 'quantity', 'qty'), c('Min Stock', 'reorder_point', 'rop'), c('Std Cost', 'unit_cost', 'money'), c('Avg Usage/Day', 'avg_daily_usage', 'adu'),
    c('Replenishment Lead Time', 'lead_time_days', 'lead'), c('List Price', null, 'money'), c('Last Count Date', null, 'created'), c('Bin', null, 'bin') ] },
  { name: 'Keystone Haulage', lang: 'en', diacritics: true, kind: 'shipments', dates: 'mdy', numbers: 'us', sep: 'comma', cols: [
    c('Load ID', 'shipment_id', 'sid'), c('Orig', 'origin', 'city'), c('Dest', 'destination', 'city'), c('SCAC', 'carrier', 'scac'),
    c('Load Status', 'status', 'status'), c('PU Date', 'ship_date', 'ship'), c('Est. Del. Date', 'estimated_delivery', 'eta'), c('Act. Del. Date', 'actual_delivery', 'act'),
    c('Linehaul $', 'shipping_cost', 'money'), c('Ord. No.', null, 'po'), c('Trailer #', null, 'iid'), c('Driver', null, 'person') ] },
  { name: 'Pinecrest Pharmacy Supply', lang: 'en', diacritics: true, kind: 'inventory', dates: 'mdy', numbers: 'plain', sep: 'comma', cols: [
    c('Item #', 'sku', 'sku'), c('Desc.', 'product_name', 'product'), c('Cat.', 'category', 'category'), c('WH', 'warehouse', 'wh'),
    c('QOH', 'quantity', 'qty'), c('ROP', 'reorder_point', 'rop'), c('Unit Cost', 'unit_cost', 'money'), c('ADU', 'avg_daily_usage', 'adu'),
    c('LT (days)', 'lead_time_days', 'lead'), c('NDC', null, 'ndc'), c('Exp. Date', null, 'created'), c('Lot #', null, 'lot') ] },

  { name: 'Công ty TNHH Vận tải Sao Mai', lang: 'vi', diacritics: true, kind: 'shipments', dates: 'dmy', numbers: 'eu', sep: 'semicolon', cols: [
    c('Mã vận đơn', 'shipment_id', 'sid'), c('Nơi gửi', 'origin', 'city'), c('Nơi nhận', 'destination', 'city'), c('Đơn vị vận chuyển', 'carrier', 'carrier'),
    c('Trạng thái', 'status', 'status'), c('Ngày gửi hàng', 'ship_date', 'ship'), c('Ngày giao dự kiến', 'estimated_delivery', 'eta'), c('Ngày giao thực tế', 'actual_delivery', 'act'),
    c('Cước phí vận chuyển', 'shipping_cost', 'money'), c('Ghi chú', null, 'note'), c('Người tạo', null, 'person'), c('Trọng lượng (kg)', null, 'weight') ] },
  { name: 'Thiết bị Minh Long', lang: 'vi', diacritics: true, kind: 'inventory', dates: 'dmy', numbers: 'eu', sep: 'semicolon', cols: [
    c('Mã hàng', 'sku', 'sku'), c('Tên sản phẩm', 'product_name', 'product'), c('Nhóm hàng', 'category', 'category'), c('Kho', 'warehouse', 'wh'),
    c('Số lượng tồn', 'quantity', 'qty'), c('Điểm đặt hàng lại', 'reorder_point', 'rop'), c('Đơn giá', 'unit_cost', 'money'), c('Mức tiêu thụ bình quân ngày', 'avg_daily_usage', 'adu'),
    c('Thời gian chờ hàng (ngày)', 'lead_time_days', 'lead'), c('Màu sắc', null, 'colour'), c('Đánh giá', null, 'rating'), c('Mã nội bộ', null, 'iid') ] },
  { name: 'Phuong Nam Express', lang: 'vi', diacritics: false, kind: 'shipments', dates: 'dmy', numbers: 'plain', sep: 'comma', cols: [
    c('Ma van don', 'shipment_id', 'sid'), c('Diem di', 'origin', 'city'), c('Diem den', 'destination', 'city'), c('Hang van chuyen', 'carrier', 'carrier'),
    c('Tinh trang', 'status', 'status'), c('Ngay xuat hang', 'ship_date', 'ship'), c('Ngay du kien giao', 'estimated_delivery', 'eta'), c('Ngay giao hang thuc te', 'actual_delivery', 'act'),
    c('Phi van chuyen', 'shipping_cost', 'money'), c('Ghi chu', null, 'note'), c('So dien thoai', null, 'phone') ] },
  { name: 'Kho Vat Tu Hoang Gia', lang: 'vi', diacritics: false, kind: 'inventory', dates: 'dmy', numbers: 'plain', sep: 'comma', cols: [
    c('Ma SKU', 'sku', 'sku'), c('Ten hang', 'product_name', 'product'), c('Loai hang', 'category', 'category'), c('Ma kho', 'warehouse', 'wh'),
    c('Ton kho', 'quantity', 'qty'), c('Muc dat hang lai', 'reorder_point', 'rop'), c('Gia von', 'unit_cost', 'money'), c('Nguoi cap nhat', null, 'person'), c('Vi tri ke', null, 'bin') ] },

  { name: 'Transportes Río Bravo S.A.', lang: 'es', diacritics: true, kind: 'shipments', dates: 'dmy', numbers: 'eu', sep: 'semicolon', cols: [
    c('Nº de guía', 'shipment_id', 'sid'), c('Origen', 'origin', 'city'), c('Destino', 'destination', 'city'), c('Transportista', 'carrier', 'carrier'),
    c('Estado del envío', 'status', 'status'), c('Fecha de envío', 'ship_date', 'ship'), c('Fecha estimada de entrega', 'estimated_delivery', 'eta'), c('Fecha de entrega real', 'actual_delivery', 'act'),
    c('Costo de envío', 'shipping_cost', 'money'), c('Observaciones', null, 'note'), c('Peso (kg)', null, 'weight'), c('Cliente', null, 'customer') ] },
  { name: 'Ferreteria La Esperanza', lang: 'es', diacritics: false, kind: 'inventory', dates: 'dmy', numbers: 'plain', sep: 'comma', cols: [
    c('Codigo SKU', 'sku', 'sku'), c('Descripcion del producto', 'product_name', 'product'), c('Categoria', 'category', 'category'), c('Almacen', 'warehouse', 'wh'),
    c('Existencias', 'quantity', 'qty'), c('Punto de reorden', 'reorder_point', 'rop'), c('Costo unitario', 'unit_cost', 'money'), c('Consumo diario promedio', 'avg_daily_usage', 'adu'),
    c('Tiempo de entrega (dias)', 'lead_time_days', 'lead'), c('Color', null, 'colour'), c('Proveedor', null, 'customer'), c('Ultima modificacion', null, 'created') ] },
  { name: 'Distribuidora Andina Ltda', lang: 'es', diacritics: false, kind: 'shipments', dates: 'dmy', numbers: 'plain', sep: 'comma', cols: [
    c('No. de Rastreo', 'shipment_id', 'sid'), c('Ciudad Origen', 'origin', 'city'), c('Ciudad Destino', 'destination', 'city'), c('Empresa de Transporte', 'carrier', 'carrier'),
    c('Situacion', 'status', 'status'), c('F. Despacho', 'ship_date', 'ship'), c('F. Entrega Estimada', 'estimated_delivery', 'eta'), c('F. Entrega', 'actual_delivery', 'act'),
    c('Flete', 'shipping_cost', 'money'), c('Notas', null, 'note'), c('Bultos', null, 'count'), c('Factura', null, 'po') ] },

  { name: 'Spedition Müller & Söhne GmbH', lang: 'de', diacritics: true, kind: 'shipments', dates: 'dot', numbers: 'eu', sep: 'semicolon', cols: [
    c('Sendungsnr.', 'shipment_id', 'sid'), c('Abgangsort', 'origin', 'city'), c('Zielort', 'destination', 'city'), c('Frachtführer', 'carrier', 'carrier'),
    c('Sendungsstatus', 'status', 'status'), c('Versanddatum', 'ship_date', 'ship'), c('Voraussichtliches Lieferdatum', 'estimated_delivery', 'eta'), c('Tatsächliches Lieferdatum', 'actual_delivery', 'act'),
    c('Frachtkosten (USD)', 'shipping_cost', 'money'), c('Bemerkungen', null, 'note'), c('Gewicht (kg)', null, 'weight'), c('Auftragsnummer', null, 'po') ] },
  { name: 'Bürotechnik Weiß AG', lang: 'de', diacritics: true, kind: 'inventory', dates: 'dot', numbers: 'eu', sep: 'semicolon', cols: [
    c('Artikelnummer', 'sku', 'sku'), c('Artikelbezeichnung', 'product_name', 'product'), c('Warengruppe', 'category', 'category'), c('Lagerort', 'warehouse', 'wh'),
    c('Lagerbestand', 'quantity', 'qty'), c('Meldebestand', 'reorder_point', 'rop'), c('Einkaufspreis', 'unit_cost', 'money'), c('Durchschnittlicher Tagesverbrauch', 'avg_daily_usage', 'adu'),
    c('Wiederbeschaffungszeit (Tage)', 'lead_time_days', 'lead'), c('Farbe', null, 'colour'), c('Bewertung', null, 'rating'), c('Zuletzt geändert von', null, 'person') ] },
  { name: 'Nordlicht Handel KG', lang: 'de', diacritics: false, kind: 'shipments', dates: 'dot', numbers: 'plain', sep: 'tab', cols: [
    c('Sendungsnummer', 'shipment_id', 'sid'), c('Versandort', 'origin', 'city'), c('Bestimmungsort', 'destination', 'city'), c('Spediteur', 'carrier', 'carrier'),
    c('Status', 'status', 'status'), c('Abholdatum', 'ship_date', 'ship'), c('Liefertermin', 'estimated_delivery', 'eta'), c('Zugestellt am', 'actual_delivery', 'act'),
    c('Versandkosten', 'shipping_cost', 'money'), c('Notizen', null, 'note'), c('Kundennummer', null, 'iid'), c('Paketanzahl', null, 'count') ] },

  { name: 'Transports Éclat Rhône SARL', lang: 'fr', diacritics: true, kind: 'shipments', dates: 'dmy', numbers: 'fr', sep: 'semicolon', cols: [
    c('N° de suivi', 'shipment_id', 'sid'), c('Ville de départ', 'origin', 'city'), c("Ville d'arrivée", 'destination', 'city'), c('Transporteur', 'carrier', 'carrier'),
    c('Statut', 'status', 'status'), c("Date d'expédition", 'ship_date', 'ship'), c('Date de livraison prévue', 'estimated_delivery', 'eta'), c('Date de livraison effective', 'actual_delivery', 'act'),
    c('Frais de port', 'shipping_cost', 'money'), c('Remarques', null, 'note'), c('Poids (kg)', null, 'weight'), c('Référence client', null, 'po') ] },
  { name: 'Quincaillerie du Château', lang: 'fr', diacritics: true, kind: 'inventory', dates: 'dmy', numbers: 'fr', sep: 'semicolon', cols: [
    c('Référence article', 'sku', 'sku'), c('Désignation', 'product_name', 'product'), c('Famille', 'category', 'category'), c('Entrepôt', 'warehouse', 'wh'),
    c('Quantité en stock', 'quantity', 'qty'), c('Seuil de réapprovisionnement', 'reorder_point', 'rop'), c('Prix unitaire', 'unit_cost', 'money'), c('Consommation moyenne journalière', 'avg_daily_usage', 'adu'),
    c('Délai de livraison (jours)', 'lead_time_days', 'lead'), c('Couleur', null, 'colour'), c('Note', null, 'rating'), c('Modifié par', null, 'person') ] },
  { name: 'Groupe Atlantique Fret', lang: 'fr', diacritics: false, kind: 'shipments', dates: 'dmy', numbers: 'plain', sep: 'comma', cols: [
    c("Numero d'expedition", 'shipment_id', 'sid'), c('Lieu de depart', 'origin', 'city'), c('Lieu de livraison', 'destination', 'city'), c('Nom du transporteur', 'carrier', 'carrier'),
    c('Etat', 'status', 'status'), c("Date d'envoi", 'ship_date', 'ship'), c('Date prevue', 'estimated_delivery', 'eta'), c('Date de reception', 'actual_delivery', 'act'),
    c('Cout du transport', 'shipping_cost', 'money'), c('Commentaire', null, 'note'), c('Volume (m3)', null, 'weight'), c('ID interne', null, 'iid') ] }
];

// Genuinely ambiguous headers placed in otherwise clear tables (truth 'AMBIG': must never be MATCHED).
export const AMBIGUITY_TABLES: Company[] = [
  { name: 'Ambig EN shipments', lang: 'en', diacritics: true, kind: 'shipments', dates: 'iso', numbers: 'plain', sep: 'comma', cols: [
    c('Shipment ID', 'shipment_id', 'sid'), c('Carrier', 'carrier', 'carrier'), c('Status', 'status', 'status'), c('Origin', 'origin', 'city'), c('Destination', 'destination', 'city'),
    c('Date', 'AMBIG', 'ship'), c('Location', 'AMBIG', 'city'), c('Cost', 'AMBIG', 'money') ] },
  { name: 'Ambig EN inventory', lang: 'en', diacritics: true, kind: 'inventory', dates: 'iso', numbers: 'plain', sep: 'comma', cols: [
    c('SKU', 'sku', 'sku'), c('Product Name', 'product_name', 'product'), c('Category', 'category', 'category'), c('Warehouse', 'warehouse', 'wh'), c('Quantity', 'quantity', 'qty'),
    c('Cost', 'AMBIG', 'money'), c('Avg Usage', 'AMBIG', 'adu'), c('Location', 'AMBIG', 'wh') ] },
  { name: 'Ambig VI shipments', lang: 'vi', diacritics: true, kind: 'shipments', dates: 'dmy', numbers: 'plain', sep: 'comma', cols: [
    c('Mã vận đơn', 'shipment_id', 'sid'), c('Đơn vị vận chuyển', 'carrier', 'carrier'), c('Trạng thái', 'status', 'status'),
    c('Ngày', 'AMBIG', 'ship'), c('Địa điểm', 'AMBIG', 'city'), c('Chi phí', 'AMBIG', 'money') ] },
  { name: 'Ambig ES shipments', lang: 'es', diacritics: true, kind: 'shipments', dates: 'dmy', numbers: 'plain', sep: 'comma', cols: [
    c('Número de envío', 'shipment_id', 'sid'), c('Transportista', 'carrier', 'carrier'), c('Estado', 'status', 'status'),
    c('Fecha', 'AMBIG', 'ship'), c('Ubicación', 'AMBIG', 'city'), c('Costo', 'AMBIG', 'money') ] },
  { name: 'Ambig DE shipments', lang: 'de', diacritics: true, kind: 'shipments', dates: 'dot', numbers: 'plain', sep: 'comma', cols: [
    c('Sendungsnummer', 'shipment_id', 'sid'), c('Spediteur', 'carrier', 'carrier'), c('Status', 'status', 'status'),
    c('Datum', 'AMBIG', 'ship'), c('Ort', 'AMBIG', 'city'), c('Kosten', 'AMBIG', 'money') ] },
  { name: 'Ambig FR shipments', lang: 'fr', diacritics: true, kind: 'shipments', dates: 'dmy', numbers: 'plain', sep: 'comma', cols: [
    c("Numéro d'expédition", 'shipment_id', 'sid'), c('Transporteur', 'carrier', 'carrier'), c('Statut', 'status', 'status'),
    c('Date', 'AMBIG', 'ship'), c('Lieu', 'AMBIG', 'city'), c('Coût', 'AMBIG', 'money') ] }
];

// ------------------------------------------------------------------------------------------------------------------
// Deterministic value generators
// ------------------------------------------------------------------------------------------------------------------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

const STATUS_WORDS: Record<Lang, Record<'pending' | 'in_transit' | 'delivered' | 'cancelled', string>> = {
  en: { pending: 'Pending', in_transit: 'In Transit', delivered: 'Delivered', cancelled: 'Cancelled' },
  vi: { pending: 'Chờ xử lý', in_transit: 'Đang vận chuyển', delivered: 'Đã giao', cancelled: 'Đã hủy' },
  es: { pending: 'Pendiente', in_transit: 'En tránsito', delivered: 'Entregado', cancelled: 'Cancelado' },
  de: { pending: 'Offen', in_transit: 'Unterwegs', delivered: 'Zugestellt', cancelled: 'Storniert' },
  fr: { pending: 'En attente', in_transit: 'En transit', delivered: 'Livré', cancelled: 'Annulé' }
};
const STRIP = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
const CITIES = ['Dallas', 'Houston', 'Atlanta', 'Chicago', 'Los Angeles', 'Newark', 'Phoenix', 'Memphis', 'Denver', 'Miami'];
const CARRIERS = ['Northstar Freight', 'Bluewave Logistics', 'Summit Express', 'Prairie Lines', 'Coastal Carriers'];
const SCAC = ['NSFT', 'BWLG', 'SMXP', 'PRLN'];
const PRODUCTS = ['Wireless Barcode Scanner', 'Steel Shelf Bracket', 'Nitrile Gloves L', 'Packing Tape 48mm', 'LED Work Light', 'Cordless Drill 18V'];
const CATEGORIES = ['Electronics', 'Hardware', 'Safety', 'Packaging', 'Tools'];
const WAREHOUSES = ['WH-DFW', 'WH-ATL', 'WH-ORD', 'WH-LAX', 'WH-EWR'];
const NOTES = ['call before delivery', 'fragile', 'dock 4', 'leave at reception', 'check seal', ''];
const PEOPLE = ['J. Carter', 'M. Nguyen', 'A. Schmidt', 'L. Moreau', 'R. Garcia'];
const COLOURS = ['Red', 'Blue', 'Black', 'Green', 'Silver'];
const CUSTOMERS = ['Acme Retail', 'Globex Stores', 'Initech Supply', 'Umbrella Mart'];
const INCOTERMS = ['FOB', 'CIF', 'DAP', 'EXW', 'DDP'];

function fmtDate(y: number, m: number, d: number, style: Company['dates']): string {
  if (style === 'iso') return `${y}-${pad(m)}-${pad(d)}`;
  if (style === 'mdy') return `${m}/${d}/${y}`;
  if (style === 'dmy') return `${pad(d)}/${pad(m)}/${y}`;
  return `${pad(d)}.${pad(m)}.${y}`;
}
function addDays(y: number, m: number, d: number, n: number): [number, number, number] {
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const x = new Date(t);
  return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()];
}
function fmtMoney(cents: number, style: Company['numbers']): string {
  const whole = Math.floor(cents / 100);
  const frac = pad(cents % 100);
  const group = (sep: string): string => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  if (style === 'plain') return `${whole}.${frac}`;
  if (style === 'us') return `${group(',')}.${frac}`;
  if (style === 'eu') return `${group('.')},${frac}`;
  return `${group(' ')},${frac}`;
}

function rowsFor(co: Company, n: number, seed: number): string[][] {
  const r = rng(seed);
  const prefix = STRIP(co.name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  const rows: string[][] = [];
  for (let i = 0; i < n; i++) {
    const st = pick(r, ['pending', 'in_transit', 'delivered', 'delivered', 'cancelled'] as const);
    const ship = addDays(2026, 3, 1, Math.floor(r() * 40));
    const eta = addDays(...ship, 2 + Math.floor(r() * 5));
    const act = addDays(...ship, 1 + Math.floor(r() * 7));
    const row = co.cols.map((col) => {
      switch (col.vt) {
        case 'sid': return `${prefix}-${100000 + i * 7 + Math.floor(r() * 5)}`;
        case 'city': return pick(r, CITIES);
        case 'carrier': return pick(r, CARRIERS);
        case 'scac': return pick(r, SCAC);
        case 'status': { const w = STATUS_WORDS[co.lang][st]; return co.diacritics ? w : STRIP(w); }
        case 'ship': return fmtDate(...ship, co.dates);
        case 'eta': return fmtDate(...eta, co.dates);
        case 'act': return st === 'delivered' ? fmtDate(...act, co.dates) : '';
        case 'created': return fmtDate(...addDays(2026, 1, 5, Math.floor(r() * 60)), co.dates);
        case 'money': return fmtMoney(500 + Math.floor(r() * 250000), co.numbers);
        case 'note': return pick(r, NOTES);
        case 'person': return pick(r, PEOPLE);
        case 'weight': return co.numbers === 'eu' || co.numbers === 'fr' ? `${1 + Math.floor(r() * 400)},${Math.floor(r() * 10)}` : `${1 + Math.floor(r() * 400)}.${Math.floor(r() * 10)}`;
        case 'colour': return pick(r, COLOURS);
        case 'rating': return String(1 + Math.floor(r() * 5));
        case 'iid': return `ID-${pad(10000 + i * 3 + Math.floor(r() * 3), 6)}`;
        case 'po': return `PO-${45000 + i}`;
        case 'customer': return pick(r, CUSTOMERS);
        case 'incoterm': return pick(r, INCOTERMS);
        case 'sku': return `${pick(r, ['ELC', 'HDW', 'SAF', 'PKG', 'TLS'])}-${9000 + i}`;
        case 'product': return pick(r, PRODUCTS);
        case 'category': return pick(r, CATEGORIES);
        case 'wh': return pick(r, WAREHOUSES);
        case 'qty': return String(Math.floor(r() * 900));
        case 'rop': return String(10 + Math.floor(r() * 90));
        case 'lead': return String(3 + Math.floor(r() * 40));
        case 'adu': return co.numbers === 'eu' || co.numbers === 'fr' ? `${Math.floor(r() * 30)},${Math.floor(r() * 10)}` : `${Math.floor(r() * 30)}.${Math.floor(r() * 10)}`;
        case 'bin': return `A-${pad(1 + Math.floor(r() * 20))}-${pad(1 + Math.floor(r() * 6))}`;
        case 'phone': return `09${Math.floor(10000000 + r() * 89999999)}`;
        case 'count': return String(1 + Math.floor(r() * 12));
        case 'ndc': return `${10000 + Math.floor(r() * 89999)}-${100 + Math.floor(r() * 899)}-${10 + Math.floor(r() * 89)}`;
        case 'lot': return `L${2600 + Math.floor(r() * 300)}`;
      }
    });
    rows.push(row);
  }
  return rows;
}

const SEP: Record<Company['sep'], string> = { comma: ',', semicolon: ';', tab: '\t' };
function render(co: Company, rows: string[][]): Uint8Array {
  const d = SEP[co.sep];
  const q = (v: string): string => (co.sep === 'tab' ? v : `"${v.replace(/"/g, '""')}"`);
  const lines = [co.cols.map((x) => q(x.h)).join(d), ...rows.map((r) => r.map(q).join(d))];
  return new TextEncoder().encode(`${lines.join('\r\n')}\r\n`);
}

// ------------------------------------------------------------------------------------------------------------------
// Evaluation
// ------------------------------------------------------------------------------------------------------------------
interface Outcome { company: string; lang: Lang; diacritics: boolean; header: string; truth: Truth; state: string; field: string | null; candidates: string[]; evidence: string[] }

async function evaluate(co: Company, seed: number): Promise<Outcome[]> {
  const bytes = render(co, rowsFor(co, 30, seed));
  const res = await analyzeFile(
    { bytes, fileName: `${co.name}.csv`, decisions: { kind: co.kind, options: new Map([['delimiter', co.sep]]) } },
    { registry: createDefaultRegistry() }
  );
  if (!res.ok) throw new Error(`${co.name}: pipeline error ${res.error.code}: ${res.error.message}`);
  const cols = res.value.preview.columns;
  if (cols.length !== co.cols.length) throw new Error(`${co.name}: expected ${co.cols.length} columns, got ${cols.length} (blockers: ${res.value.preview.blockers.map((b) => b.code).join(',')})`);
  return co.cols.map((col, i) => {
    const pc = cols[i];
    if (pc === undefined || pc.header !== col.h) throw new Error(`${co.name}: column ${i} header mismatch: ${pc?.header} vs ${col.h}`);
    return { company: co.name, lang: co.lang, diacritics: co.diacritics, header: col.h, truth: col.truth, state: pc.state, field: pc.field, candidates: pc.candidates.map((x) => x.field), evidence: pc.evidence };
  });
}

interface Metrics { headers: number; withTruth: number; matchedRight: number; checkRight: number; chooseRightCandidate: number; wrongMatched: number; junk: number; junkMatched: number; junkCheck: number; ambig: number; ambigMatched: number; ambigCheck: number; check: number; checkWrong: number; recall: number; checkWrongRate: number }
function metrics(os: readonly Outcome[]): Metrics {
  const m = { headers: os.length, withTruth: 0, matchedRight: 0, checkRight: 0, chooseRightCandidate: 0, wrongMatched: 0, junk: 0, junkMatched: 0, junkCheck: 0, ambig: 0, ambigMatched: 0, ambigCheck: 0, check: 0, checkWrong: 0, recall: 0, checkWrongRate: 0 };
  for (const o of os) {
    const real = o.truth !== null && o.truth !== 'AMBIG';
    if (real) m.withTruth++;
    if (o.truth === null) m.junk++;
    if (o.truth === 'AMBIG') m.ambig++;
    if (o.state === 'matched') {
      if (real && o.field === o.truth) m.matchedRight++;
      else m.wrongMatched++;
      if (o.truth === null) m.junkMatched++;
      if (o.truth === 'AMBIG') m.ambigMatched++;
    }
    if (o.state === 'check') {
      m.check++;
      if (real && o.field === o.truth) m.checkRight++;
      else m.checkWrong++;
      if (o.truth === null) m.junkCheck++;
      if (o.truth === 'AMBIG') m.ambigCheck++;
    }
    if (o.state === 'choose' && real && o.candidates.includes(o.truth as string)) m.chooseRightCandidate++;
  }
  m.recall = m.withTruth === 0 ? 1 : (m.matchedRight + m.checkRight) / m.withTruth;
  m.checkWrongRate = m.check === 0 ? 0 : m.checkWrong / m.check;
  return m;
}

describe('TESTER held-out corpus (criterion 46), independent of the Coder', () => {
  it('meets the criterion-46 thresholds on an independent multilingual corpus and reports the numbers', async () => {
    const all: Outcome[] = [];
    let seed = 1000;
    for (const co of [...COMPANIES, ...AMBIGUITY_TABLES]) all.push(...(await evaluate(co, seed++)));
    const main = all.filter((o) => COMPANIES.some((co) => co.name === o.company));
    const amb = all.filter((o) => AMBIGUITY_TABLES.some((co) => co.name === o.company));
    const byLang = Object.fromEntries((['en', 'vi', 'es', 'de', 'fr'] as const).map((l) => [l, metrics(main.filter((o) => o.lang === l))]));
    const byDiacritics = { with: metrics(main.filter((o) => o.diacritics && o.lang !== 'en')), without: metrics(main.filter((o) => !o.diacritics)) };
    const report = {
      companies: COMPANIES.length,
      ambiguityTables: AMBIGUITY_TABLES.length,
      overall: metrics(main),
      byLang,
      byDiacritics,
      ambiguityTablesMetrics: metrics(amb),
      misses: main.filter((o) => o.truth !== null && o.truth !== 'AMBIG' && !((o.state === 'matched' || o.state === 'check') && o.field === o.truth)).map((o) => ({ company: o.company, header: o.header, truth: o.truth, state: o.state, field: o.field, candidates: o.candidates })),
      wrong: all.filter((o) => (o.state === 'matched' || o.state === 'check') && o.field !== o.truth).map((o) => ({ company: o.company, header: o.header, truth: o.truth, state: o.state, field: o.field, evidence: o.evidence })),
      ambiguous: amb.filter((o) => o.truth === 'AMBIG').map((o) => ({ company: o.company, header: o.header, state: o.state, field: o.field, candidates: o.candidates })),
      noEvidence: all.filter((o) => o.state !== 'ignored' && o.evidence.length === 0).map((o) => `${o.company}/${o.header}`)
    };
    writeFileSync(join(tmpdir(), 'scc-tester-heldout.json'), JSON.stringify(report, null, 2));

    const o = report.overall;
    expect(o.headers).toBeGreaterThanOrEqual(150);
    expect(report.wrong.filter((w) => w.state === 'matched')).toEqual([]); // wrong MATCHED = 0 (includes junk and ambiguous)
    expect(o.junkMatched).toBe(0);
    expect(report.ambiguityTablesMetrics.ambigMatched).toBe(0);
    expect(o.recall).toBeGreaterThanOrEqual(0.8);
    expect(o.checkWrongRate).toBeLessThanOrEqual(0.1);
    expect(report.noEvidence).toEqual([]);
  }, 120000);

  it('SA-5 on this corpus: byte-identical results across runs, permuted columns permute the result, no clock/random/network, dataset auto-detection recorded', async () => {
    const registry = createDefaultRegistry();
    // inputs are generated BEFORE the stubs (the generator itself uses Date.UTC)
    const jobs = COMPANIES.map((co, k) => {
      const rows = rowsFor(co, 30, 5000 + k);
      const order = co.cols.map((_, i) => i).reverse(); // a deterministic permutation: reversed column order
      const permuted: Company = { ...co, cols: order.map((i) => co.cols[i] as Col) };
      return { co, bytes: render(co, rows), permutedBytes: render(permuted, rows.map((r) => order.map((i) => r[i] as string))), order };
    });
    const realDate = Date;
    const fetchCalls: unknown[] = [];
    const originalFetch = globalThis.fetch;
    const originalRandom = Math.random;
    Math.random = () => { throw new Error('Math.random used'); };
    (globalThis as { fetch: unknown }).fetch = (...a: unknown[]) => { fetchCalls.push(a); throw new Error('fetch used'); };
    (globalThis as { Date: unknown }).Date = new Proxy(realDate, {
      construct(target, args: unknown[]) { if (args.length === 0) throw new Error('new Date() used'); return Reflect.construct(target, args); },
      get(target, prop, recv) { if (prop === 'now') return () => { throw new Error('Date.now used'); }; return Reflect.get(target, prop, recv); }
    });
    const results: Array<{ name: string; a: string; b: string; permutedOk: boolean; ignoredWithoutEvidence: number; autoKind: string | null }> = [];
    try {
      for (const j of jobs) {
        const run = async (bytes: Uint8Array, withKind: boolean) => {
          const r = await analyzeFile({ bytes, fileName: 'x.csv', decisions: { ...(withKind ? { kind: j.co.kind } : {}), options: new Map([['delimiter', j.co.sep]]) } }, { registry });
          if (!r.ok) throw new Error(r.error.code);
          return r.value;
        };
        const first = await run(j.bytes, true);
        const second = await run(j.bytes, true);
        const permuted = await run(j.permutedBytes, true);
        const auto = await run(j.bytes, false);
        const strip = (cols: typeof first.preview.columns) => cols.map((c) => ({ header: c.header, state: c.state, field: c.field, confidence: c.confidence, candidates: c.candidates, evidence: c.evidence, warnings: c.warnings }));
        // permuted file: the same header must get the same decision, evidence and warnings (headers are unique per file)
        const byHeader = new Map(strip(permuted.preview.columns).map((c) => [c.header, c]));
        const permutedOk = strip(first.preview.columns).every((c) => JSON.stringify(byHeader.get(c.header)) === JSON.stringify(c));
        results.push({
          name: j.co.name,
          a: JSON.stringify(first.preview),
          b: JSON.stringify(second.preview),
          permutedOk,
          ignoredWithoutEvidence: first.preview.columns.filter((c) => c.state === 'ignored' && c.evidence.length === 0).length,
          autoKind: auto.preview.dataset.kind
        });
      }
    } finally {
      Math.random = originalRandom;
      (globalThis as { fetch: unknown }).fetch = originalFetch;
      (globalThis as { Date: unknown }).Date = realDate;
    }
    writeFileSync(join(tmpdir(), 'scc-tester-determinism.json'), JSON.stringify(results.map((r) => ({ name: r.name, identical: r.a === r.b, permutedOk: r.permutedOk, ignoredWithoutEvidence: r.ignoredWithoutEvidence, autoKind: r.autoKind })), null, 1));
    expect(fetchCalls).toEqual([]);
    for (const r of results) expect(r.a, r.name).toBe(r.b);
    expect(results.filter((r) => !r.permutedOk).map((r) => r.name)).toEqual([]);
    // dataset auto-detection never picks the WRONG dataset (null = the user is asked, acceptable)
    for (const r of results) expect([null, COMPANIES.find((c) => c.name === r.name)?.kind], r.name).toContain(r.autoKind);
  }, 120000);
});
