// English header synonyms. STATUS: needs native review. Every phrase of the V1.5 alias table (src/shared/mapping/aliases.ts)
// is STRONG here with the same field, and the headers V1.5 treats as ambiguous stay ambiguous with the same candidates.
// Rows are [phrase, example]: the phrase lowercase; the example a realistic header that contains it.

import type { DictionaryFile } from './index';

export const en: DictionaryFile = {
  language: 'en',
  reviewStatus: 'needs native review',
  version: '1.0.0',
  groups: [
    // ---- inventory ----
    {
      kind: 'inventory',
      field: 'sku',
      strong: [
        ['item code', 'Item Code'],
        ['product id', 'Product ID'],
        ['material number', 'Material Number'],
        ['material code', 'Material Code'],
        ['item number', 'Item Number'],
        ['item no', 'Item No.'],
        ['item id', 'Item ID'],
        ['product code', 'Product Code'],
        ['part number', 'Part Number'],
        ['part no', 'Part No'],
        ['sku code', 'SKU Code'],
        ['stock keeping unit', 'Stock Keeping Unit'],
        ['article number', 'Article Number'],
        ['article code', 'Article Code']
      ],
      medium: [
        ['material', 'Material'],
        ['product number', 'Product Number'],
        ['part', 'Part']
      ]
    },
    {
      kind: 'inventory',
      field: 'product_name',
      strong: [
        ['product', 'Product'],
        ['item description', 'Item Description'],
        ['product description', 'Product Description'],
        ['item name', 'Item Name'],
        ['product name', 'Product Name'],
        ['material description', 'Material Description'],
        ['article description', 'Article Description'],
        ['article name', 'Article Name']
      ],
      medium: [
        ['description', 'Description'],
        ['desc', 'Desc'],
        ['article', 'Article']
      ]
    },
    {
      kind: 'inventory',
      field: 'category',
      strong: [
        ['product category', 'Product Category'],
        ['item category', 'Item Category'],
        ['product group', 'Product Group'],
        ['material group', 'Material Group'],
        ['product family', 'Product Family'],
        ['item group', 'Item Group'],
        ['commodity group', 'Commodity Group'],
        ['merchandise category', 'Merchandise Category']
      ],
      medium: [
        ['group', 'Group'],
        ['family', 'Family'],
        ['department', 'Department'],
        ['dept', 'Dept'],
        ['cat', 'Cat']
      ],
      weak: [['class', 'Class']]
    },
    {
      kind: 'inventory',
      field: 'warehouse',
      strong: [
        ['wh', 'WH'],
        ['plant', 'Plant'],
        ['plant code', 'Plant Code'],
        ['location', 'Location'],
        ['warehouse code', 'Warehouse Code'],
        ['warehouse name', 'Warehouse Name'],
        ['storage location', 'Storage Location'],
        ['stock location', 'Stock Location'],
        ['distribution center', 'Distribution Center'],
        ['distribution centre', 'Distribution Centre']
      ],
      medium: [
        ['dc', 'DC'],
        ['depot', 'Depot'],
        ['site', 'Site'],
        ['loc', 'Loc'],
        ['facility', 'Facility']
      ]
    },
    {
      kind: 'inventory',
      field: 'quantity',
      strong: [
        ['qty', 'Qty'],
        ['on hand', 'On Hand'],
        ['on hand qty', 'On Hand Qty'],
        ['available qty', 'Available Qty'],
        ['stock qty', 'Stock Qty'],
        ['inventory balance', 'Inventory Balance'],
        ['available stock', 'Available Stock'],
        ['quantity on hand', 'Quantity on Hand'],
        ['units on hand', 'Units On Hand'],
        ['unrestricted stock', 'Unrestricted Stock'],
        ['unrestricted qty', 'Unrestricted Qty'],
        ['stock on hand', 'Stock on Hand'],
        ['current stock', 'Current Stock'],
        ['stock level', 'Stock Level'],
        ['qoh', 'QOH']
      ],
      medium: [
        ['stock', 'Stock'],
        ['oh qty', 'OH Qty'],
        ['units', 'Units']
      ],
      weak: [['balance', 'Balance']]
    },
    {
      kind: 'inventory',
      field: 'reorder_point',
      strong: [
        ['reorder level', 'Reorder Level'],
        ['rop', 'ROP'],
        ['reorder threshold', 'Reorder Threshold'],
        ['minimum stock', 'Minimum Stock'],
        ['min stock', 'Min Stock'],
        ['replenishment point', 'Replenishment Point'],
        ['restock level', 'Restock Level'],
        ['reorder pt', 'Reorder Pt']
      ],
      medium: [
        ['min level', 'Min Level'],
        ['minimum level', 'Minimum Level'],
        ['safety stock', 'Safety Stock']
      ],
      weak: [['min', 'Min']]
    },
    {
      kind: 'inventory',
      field: 'unit_cost',
      strong: [
        ['unit price', 'Unit Price'],
        ['price', 'Price'],
        ['standard cost', 'Standard Cost'],
        ['cost per unit', 'Cost per Unit'],
        ['std price', 'Std Price'],
        ['standard price', 'Standard Price'],
        ['purchase price', 'Purchase Price'],
        ['cost each', 'Cost Each'],
        ['price each', 'Price Each'],
        ['cost price', 'Cost Price'],
        ['buying price', 'Buying Price']
      ],
      medium: [
        ['item cost', 'Item Cost'],
        ['average cost', 'Average Cost'],
        ['avg cost', 'Avg Cost']
      ]
    },
    {
      kind: 'inventory',
      field: 'avg_daily_usage',
      strong: [
        ['daily usage', 'Daily Usage'],
        ['daily consumption', 'Daily Consumption'],
        ['average daily demand', 'Average Daily Demand'],
        ['average daily usage', 'Average Daily Usage'],
        ['avg daily usage', 'Avg Daily Usage'],
        ['avg daily demand', 'Avg Daily Demand'],
        ['daily demand', 'Daily Demand'],
        ['avg daily consumption', 'Avg Daily Consumption'],
        ['average daily consumption', 'Average Daily Consumption']
      ],
      weak: [
        ['usage', 'Usage'],
        ['demand', 'Demand']
      ]
    },
    {
      kind: 'inventory',
      field: 'lead_time_days',
      strong: [
        ['lead time', 'Lead Time'],
        ['supplier lead time', 'Supplier Lead Time'],
        ['supply lead time', 'Supply Lead Time'],
        ['replenishment lead time', 'Replenishment Lead Time'],
        ['replenishment days', 'Replenishment Days'],
        ['planned delivery time', 'Planned Delivery Time (Days)'],
        ['procurement lead time', 'Procurement Lead Time']
      ],
      medium: [['delivery time', 'Delivery Time']]
    },
    // ---- shipments ----
    {
      kind: 'shipments',
      field: 'shipment_id',
      strong: [
        ['shipment number', 'Shipment Number'],
        ['load id', 'Load ID'],
        ['shipment id', 'Shipment ID'],
        ['consignment reference', 'Consignment Reference'],
        ['consignment number', 'Consignment Number'],
        ['consignment no', 'Consignment No'],
        ['consignment id', 'Consignment ID'],
        ['waybill', 'Waybill'],
        ['waybill number', 'Waybill Number'],
        ['waybill no', 'Waybill No'],
        ['airway bill', 'Airway Bill'],
        ['awb', 'AWB'],
        ['bill of lading', 'Bill of Lading'],
        ['bol', 'BOL'],
        ['load number', 'Load Number'],
        ['load no', 'Load No']
      ],
      medium: [
        ['tracking number', 'Tracking Number'],
        ['tracking no', 'Tracking No.'],
        ['tracking id', 'Tracking ID'],
        ['pro number', 'PRO Number'],
        ['pro no', 'PRO No'],
        ['delivery number', 'Delivery Number'],
        ['shipment reference', 'Shipment Reference'],
        ['shipment ref', 'Shipment Ref']
      ],
      weak: [
        ['order no', 'Order No.'],
        ['order number', 'Order Number'],
        ['order id', 'Order ID'],
        ['reference', 'Reference'],
        ['ref', 'Ref'],
        ['ref no', 'Ref No']
      ],
      note: 'may identify an order rather than a shipment'
    },
    {
      kind: 'shipments',
      field: 'origin',
      strong: [
        ['origin location', 'Origin Location'],
        ['from', 'From'],
        ['origin', 'Origin'],
        ['ship from', 'Ship From'],
        ['shipped from', 'Shipped From'],
        ['pickup location', 'Pickup Location'],
        ['pickup from', 'Pickup From'],
        ['pickup city', 'Pickup City'],
        ['origin city', 'Origin City'],
        ['origin terminal', 'Origin Terminal'],
        ['origin warehouse', 'Origin Warehouse'],
        ['departure location', 'Departure Location'],
        ['departure city', 'Departure City'],
        ['origin site', 'Origin Site']
      ],
      medium: [['source', 'Source']]
    },
    {
      kind: 'shipments',
      field: 'destination',
      strong: [
        ['destination location', 'Destination Location'],
        ['to', 'To'],
        ['destination', 'Destination'],
        ['ship to', 'Ship To'],
        ['shipped to', 'Shipped To'],
        ['delivery location', 'Delivery Location'],
        ['drop city', 'Drop City'],
        ['drop location', 'Drop Location'],
        ['destination city', 'Destination City'],
        ['destination terminal', 'Destination Terminal'],
        ['deliver to', 'Deliver To'],
        ['arrival location', 'Arrival Location']
      ]
    },
    {
      kind: 'shipments',
      field: 'carrier',
      strong: [
        ['transporter', 'Transporter'],
        ['logistics provider', 'Logistics Provider'],
        ['carrier', 'Carrier'],
        ['carrier name', 'Carrier Name'],
        ['haulier', 'Haulier'],
        ['hauler', 'Hauler'],
        ['freight carrier', 'Freight Carrier'],
        ['forwarder', 'Forwarder'],
        ['courier', 'Courier'],
        ['transport company', 'Transport Company'],
        ['trucking company', 'Trucking Company'],
        ['transportation provider', 'Transportation Provider'],
        ['shipping company', 'Shipping Company']
      ]
    },
    {
      kind: 'shipments',
      field: 'status',
      strong: [
        ['shipment status', 'Shipment Status'],
        ['status', 'Status'],
        ['load status', 'Load Status'],
        ['delivery status', 'Delivery Status'],
        ['tracking status', 'Tracking Status']
      ],
      weak: [['state', 'State']]
    },
    {
      kind: 'shipments',
      field: 'ship_date',
      strong: [
        ['shipping date', 'Shipping Date'],
        ['dispatch date', 'Dispatch Date'],
        ['ship date', 'Ship Date'],
        ['shipped on', 'Shipped On'],
        ['shipped date', 'Shipped Date'],
        ['pickup date', 'Pickup Date'],
        ['pick up date', 'Pick Up Date'],
        ['departure date', 'Departure Date'],
        ['date shipped', 'Date Shipped'],
        ['dispatched on', 'Dispatched On'],
        ['despatch date', 'Despatch Date']
      ],
      medium: [['ship dt', 'Ship Dt']]
    },
    {
      kind: 'shipments',
      field: 'estimated_delivery',
      strong: [
        ['eta', 'ETA'],
        ['expected delivery', 'Expected Delivery'],
        ['estimated delivery', 'Estimated Delivery'],
        ['estimated delivery date', 'Estimated Delivery Date'],
        ['expected delivery date', 'Expected Delivery Date'],
        ['planned delivery', 'Planned Delivery'],
        ['planned delivery date', 'Planned Delivery Date'],
        ['scheduled delivery', 'Scheduled Delivery'],
        ['scheduled delivery date', 'Scheduled Delivery Date'],
        ['promised delivery', 'Promised Delivery'],
        ['eta date', 'ETA Date'],
        ['estimated arrival', 'Estimated Arrival'],
        ['expected arrival', 'Expected Arrival']
      ],
      medium: [
        ['due date', 'Due Date'],
        ['promised date', 'Promised Date']
      ]
    },
    {
      kind: 'shipments',
      field: 'actual_delivery',
      strong: [
        ['delivery date', 'Delivery Date'],
        ['delivered date', 'Delivered Date'],
        ['actual delivery', 'Actual Delivery'],
        ['actual delivery date', 'Actual Delivery Date'],
        ['delivered on', 'Delivered On'],
        ['date delivered', 'Date Delivered'],
        ['pod date', 'POD Date'],
        ['proof of delivery date', 'Proof of Delivery Date'],
        ['actual arrival', 'Actual Arrival']
      ],
      medium: [
        ['arrival date', 'Arrival Date'],
        ['received date', 'Received Date']
      ]
    },
    {
      kind: 'shipments',
      field: 'shipping_cost',
      strong: [
        ['freight cost', 'Freight Cost'],
        ['transport cost', 'Transport Cost'],
        ['shipping cost', 'Shipping Cost'],
        ['freight charge', 'Freight Charge'],
        ['freight charges', 'Freight Charges'],
        ['freight amount', 'Freight Amount'],
        ['shipping charge', 'Shipping Charge'],
        ['shipping fee', 'Shipping Fee'],
        ['delivery cost', 'Delivery Cost'],
        ['transport charge', 'Transport Charge'],
        ['carrier cost', 'Carrier Cost'],
        ['total freight', 'Total Freight']
      ],
      medium: [
        ['total charges', 'Total Charges'],
        ['freight', 'Freight']
      ]
    }
  ],
  ambiguous: [
    { kind: 'inventory', phrase: 'cost', example: 'Cost', candidates: ['unit_cost'] },
    { kind: 'inventory', phrase: 'avg usage', example: 'Avg Usage', candidates: ['avg_daily_usage'] },
    { kind: 'shipments', phrase: 'cost', example: 'Cost', candidates: ['shipping_cost'] },
    { kind: 'shipments', phrase: 'date', example: 'Date', candidates: ['ship_date', 'estimated_delivery', 'actual_delivery'] },
    { kind: 'shipments', phrase: 'location', example: 'Location', candidates: ['origin', 'destination'] }
  ]
};
