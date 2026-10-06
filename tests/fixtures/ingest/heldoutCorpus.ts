// HELD-OUT mapping corpus (criterion 46). Written BEFORE the dictionaries and without consulting them: the headers are
// what people in each language plausibly call these columns in ERP/WMS/TMS exports. It must never be used to tune the
// dictionaries; if a threshold fails, the fix is a general improvement or a recorded deviation. Invented data only.

import { G, col, type CorpusCase } from './gen';

export const HELD_OUT: CorpusCase[] = [
  {
    id: 'h01-sap-inventory-en',
    language: 'en',
    kind: 'inventory',
    columns: [
      col('Material', 'sku', G.sku('MAT-')),
      col('Material Description', 'product_name', G.productName()),
      col('Material Group', 'category', G.category()),
      col('Plant', 'warehouse', G.warehouse('code')),
      col('Unrestricted Stock', 'quantity', G.int(0, 900)),
      col('Reorder Point', 'reorder_point', G.int(10, 120)),
      col('Standard Price', 'unit_cost', G.money()),
      col('Base Unit of Measure', null, G.unit()),
      col('Created On', null, G.date('iso')),
      col('Planned Delivery Time (Days)', 'lead_time_days', G.int(2, 40)),
      col('Net Weight', null, G.weight())
    ]
  },
  {
    id: 'h02-wms-inventory-en',
    language: 'en',
    kind: 'inventory',
    columns: [
      col('Item ID', 'sku', G.sku('WMS-')),
      col('Item Name', 'product_name', G.productName()),
      col('Dept', 'category', G.category()),
      col('DC', 'warehouse', G.warehouse('short')),
      col('Units On Hand', 'quantity', G.int(0, 900)),
      col('Min Level', 'reorder_point', G.int(10, 120)),
      col('Cost Each', 'unit_cost', G.money()),
      col('Daily Demand', 'avg_daily_usage', G.decimal()),
      col('Replenishment Days', 'lead_time_days', G.int(2, 40)),
      col('Bin', null, G.bin()),
      col('Last Counted', null, G.date('iso')),
      col('Supplier', null, G.carrier())
    ]
  },
  {
    id: 'h03-tms-shipments-en',
    language: 'en',
    kind: 'shipments',
    columns: [
      col('Load Number', 'shipment_id', G.shipmentId('LD-')),
      col('Pickup City', 'origin', G.city()),
      col('Drop City', 'destination', G.city(3)),
      col('Carrier Name', 'carrier', G.carrier()),
      col('Load Status', 'status', G.status('en')),
      col('Pickup Date', 'ship_date', G.date('iso')),
      col('Scheduled Delivery', 'estimated_delivery', G.date('iso', 3)),
      col('Actual Delivery Date', 'actual_delivery', G.date('iso', 4)),
      col('Total Charges', 'shipping_cost', G.money()),
      col('PO Number', null, G.po()),
      col('Weight (lbs)', null, G.weight())
    ]
  },
  {
    id: 'h04-broker-shipments-en',
    language: 'en',
    kind: 'shipments',
    columns: [
      col('Waybill No', 'shipment_id', G.shipmentId('WB')),
      col('From', 'origin', G.city()),
      col('To', 'destination', G.city(2)),
      col('Logistics Provider', 'carrier', G.carrier()),
      col('State', 'status', G.status('en')),
      col('Ship Dt', 'ship_date', G.date('iso')),
      col('ETA Date', 'estimated_delivery', G.date('iso', 3)),
      col('POD Date', 'actual_delivery', G.date('iso', 4)),
      col('Freight Cost USD', 'shipping_cost', G.money()),
      col('Pieces', null, G.pieces()),
      col('Customer', null, G.customer())
    ]
  },
  {
    id: 'h05-inventory-es',
    language: 'es',
    kind: 'inventory',
    columns: [
      col('Código de Artículo', 'sku', G.sku('ART-')),
      col('Descripción del Producto', 'product_name', G.productName()),
      col('Familia', 'category', G.category()),
      col('Almacén', 'warehouse', G.warehouse('code')),
      col('Existencias', 'quantity', G.int(0, 900)),
      col('Punto de Pedido', 'reorder_point', G.int(10, 120)),
      col('Costo Unitario', 'unit_cost', G.money('eu')),
      col('Consumo Diario Promedio', 'avg_daily_usage', G.decimal('eu')),
      col('Plazo de Entrega (días)', 'lead_time_days', G.int(2, 40)),
      col('Proveedor', null, G.carrier())
    ]
  },
  {
    id: 'h06-shipments-es',
    language: 'es',
    kind: 'shipments',
    columns: [
      col('Nº de Guía', 'shipment_id', G.shipmentId('GU-')),
      col('Origen', 'origin', G.city()),
      col('Destino', 'destination', G.city(2)),
      col('Transportista', 'carrier', G.carrier()),
      col('Estado', 'status', G.status('es')),
      col('Fecha de Salida', 'ship_date', G.date('dmy')),
      col('Fecha Prevista de Entrega', 'estimated_delivery', G.date('dmy', 3)),
      col('Fecha de Entrega Real', 'actual_delivery', G.date('dmy', 4)),
      col('Importe del Flete', 'shipping_cost', G.money('eu')),
      col('Bultos', null, G.pieces())
    ]
  },
  {
    id: 'h07-inventory-de',
    language: 'de',
    kind: 'inventory',
    columns: [
      col('Artikelnummer', 'sku', G.sku('AR-')),
      col('Artikelbezeichnung', 'product_name', G.productName()),
      col('Warengruppe', 'category', G.category()),
      col('Lagerort', 'warehouse', G.warehouse('name')),
      col('Lagerbestand', 'quantity', G.int(0, 900)),
      col('Meldebestand', 'reorder_point', G.int(10, 120)),
      col('Einkaufspreis', 'unit_cost', G.money('eu')),
      col('Durchschnittlicher Tagesverbrauch', 'avg_daily_usage', G.decimal('eu')),
      col('Wiederbeschaffungszeit (Tage)', 'lead_time_days', G.int(2, 40)),
      col('Gewicht', null, G.weight()),
      col('Lieferant', null, G.carrier())
    ]
  },
  {
    id: 'h08-shipments-de',
    language: 'de',
    kind: 'shipments',
    columns: [
      col('Sendungsnr.', 'shipment_id', G.shipmentId('SN-')),
      col('Versandort', 'origin', G.city()),
      col('Lieferort', 'destination', G.city(2)),
      col('Spediteur', 'carrier', G.carrier()),
      col('Sendungsstatus', 'status', G.status('de')),
      col('Versanddatum', 'ship_date', G.date('dot')),
      col('Voraussichtliche Lieferung', 'estimated_delivery', G.date('dot', 3)),
      col('Zustelldatum', 'actual_delivery', G.date('dot', 4)),
      col('Frachtkosten', 'shipping_cost', G.money('eu')),
      col('Gewicht kg', null, G.weight())
    ]
  },
  {
    id: 'h09-inventory-fr',
    language: 'fr',
    kind: 'inventory',
    columns: [
      col('Référence Article', 'sku', G.sku('RF-')),
      col('Désignation', 'product_name', G.productName()),
      col('Catégorie', 'category', G.category()),
      col('Entrepôt', 'warehouse', G.warehouse('code')),
      col('Quantité en Stock', 'quantity', G.int(0, 900)),
      col('Seuil de Réapprovisionnement', 'reorder_point', G.int(10, 120)),
      col("Prix d'Achat Unitaire", 'unit_cost', G.money('fr')),
      col('Consommation Journalière Moyenne', 'avg_daily_usage', G.decimal('fr')),
      col("Délai d'Approvisionnement (jours)", 'lead_time_days', G.int(2, 40)),
      col('Fournisseur', null, G.carrier())
    ]
  },
  {
    id: 'h10-shipments-fr',
    language: 'fr',
    kind: 'shipments',
    columns: [
      col('N° de Suivi', 'shipment_id', G.shipmentId('SV-')),
      col('Ville de Départ', 'origin', G.city()),
      col("Ville d'Arrivée", 'destination', G.city(2)),
      col('Transporteur', 'carrier', G.carrier()),
      col('Statut', 'status', G.status('fr')),
      col("Date d'Expédition", 'ship_date', G.date('dmy')),
      col('Date de Livraison Prévue', 'estimated_delivery', G.date('dmy', 3)),
      col('Date de Livraison Réelle', 'actual_delivery', G.date('dmy', 4)),
      col('Coût du Transport', 'shipping_cost', G.money('fr')),
      col('Poids', null, G.weight())
    ]
  },
  {
    id: 'h11-inventory-vi',
    language: 'vi',
    kind: 'inventory',
    columns: [
      col('Mã hàng', 'sku', G.sku('MH-')),
      col('Tên sản phẩm', 'product_name', G.productName()),
      col('Nhóm hàng', 'category', G.category()),
      col('Kho', 'warehouse', G.warehouse('code')),
      col('Tồn kho', 'quantity', G.int(0, 900)),
      col('Mức đặt hàng lại', 'reorder_point', G.int(10, 120)),
      col('Đơn giá', 'unit_cost', G.money('eu')),
      col('Mức tiêu thụ trung bình ngày', 'avg_daily_usage', G.decimal('eu')),
      col('Thời gian giao hàng (ngày)', 'lead_time_days', G.int(2, 40)),
      col('Nhà cung cấp', null, G.carrier())
    ]
  },
  {
    id: 'h12-shipments-vi',
    language: 'vi',
    kind: 'shipments',
    columns: [
      col('Mã vận đơn', 'shipment_id', G.shipmentId('VD-')),
      col('Nơi gửi', 'origin', G.city()),
      col('Nơi nhận', 'destination', G.city(2)),
      col('Đơn vị vận chuyển', 'carrier', G.carrier()),
      col('Trạng thái', 'status', G.status('vi')),
      col('Ngày gửi hàng', 'ship_date', G.date('dmy')),
      col('Ngày giao dự kiến', 'estimated_delivery', G.date('dmy', 3)),
      col('Ngày giao thực tế', 'actual_delivery', G.date('dmy', 4)),
      col('Cước phí', 'shipping_cost', G.money('eu')),
      col('Số kiện', null, G.pieces())
    ]
  },
  {
    id: 'h13-abbreviations-inventory-en',
    language: 'en',
    kind: 'inventory',
    columns: [
      col('SKU #', 'sku', G.sku('AB-')),
      col('Desc', 'product_name', G.productName()),
      col('Cat', 'category', G.category()),
      col('Loc', 'warehouse', G.warehouse('code')),
      col('OH Qty', 'quantity', G.int(0, 900)),
      col('ROP', 'reorder_point', G.int(10, 120)),
      col('Unit $', 'unit_cost', G.money()),
      col('Lead Days', 'lead_time_days', G.int(2, 40)),
      col('Notes', null, G.text('Note'))
    ]
  },
  {
    id: 'h14-distractors-shipments-en',
    language: 'en',
    kind: 'shipments',
    columns: [
      col('Consignment No', 'shipment_id', G.shipmentId('CN-')),
      col('Origin Terminal', 'origin', G.city()),
      col('Destination Terminal', 'destination', G.city(2)),
      col('Haulier', 'carrier', G.carrier()),
      col('Status', 'status', G.status('en')),
      col('Dispatch Date', 'ship_date', G.date('iso')),
      col('Expected Delivery', 'estimated_delivery', G.date('iso', 3)),
      col('Shipping Cost', 'shipping_cost', G.money()),
      col('Customer Reference', null, G.po()),
      col('Invoice Number', null, G.invoice()),
      col('Tracking URL', null, G.url()),
      col('Pallets', null, G.pieces()),
      col('Comments', null, G.text('Handle with care'))
    ]
  }
];
