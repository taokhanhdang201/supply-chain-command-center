// Spanish header synonyms (accents are folded when matching). STATUS: needs native review. Rows are [phrase, example].

import type { DictionaryFile } from './index';

export const es: DictionaryFile = {
  language: 'es',
  reviewStatus: 'needs native review',
  version: '1.0.0',
  groups: [
    // ---- inventory ----
    {
      kind: 'inventory',
      field: 'sku',
      strong: [
        ['código de artículo', 'Código de Artículo'],
        ['código de producto', 'Código de Producto'],
        ['número de artículo', 'Número de Artículo'],
        ['número de material', 'Número de Material'],
        ['código de material', 'Código de Material'],
        ['referencia del artículo', 'Referencia del Artículo'],
        ['id de producto', 'ID de Producto'],
        ['código de referencia', 'Código de Referencia']
      ],
      medium: [['código', 'Código']],
      weak: [['referencia', 'Referencia']]
    },
    {
      kind: 'inventory',
      field: 'product_name',
      strong: [
        ['descripción del producto', 'Descripción del Producto'],
        ['descripción del artículo', 'Descripción del Artículo'],
        ['nombre del producto', 'Nombre del Producto'],
        ['nombre del artículo', 'Nombre del Artículo'],
        ['denominación del artículo', 'Denominación del Artículo']
      ],
      medium: [
        ['descripción', 'Descripción'],
        ['producto', 'Producto'],
        ['artículo', 'Artículo']
      ]
    },
    {
      kind: 'inventory',
      field: 'category',
      strong: [
        ['categoría', 'Categoría'],
        ['categoría de producto', 'Categoría de Producto'],
        ['categoría del artículo', 'Categoría del Artículo'],
        ['grupo de artículos', 'Grupo de Artículos'],
        ['grupo de productos', 'Grupo de Productos'],
        ['familia de productos', 'Familia de Productos']
      ],
      medium: [
        ['familia', 'Familia'],
        ['grupo', 'Grupo'],
        ['rubro', 'Rubro'],
        ['línea', 'Línea']
      ]
    },
    {
      kind: 'inventory',
      field: 'warehouse',
      strong: [
        ['almacén', 'Almacén'],
        ['código de almacén', 'Código de Almacén'],
        ['nombre del almacén', 'Nombre del Almacén'],
        ['centro de distribución', 'Centro de Distribución'],
        ['bodega', 'Bodega'],
        ['depósito', 'Depósito']
      ],
      medium: [
        ['centro', 'Centro'],
        ['ubicación', 'Ubicación'],
        ['sucursal', 'Sucursal']
      ]
    },
    {
      kind: 'inventory',
      field: 'quantity',
      strong: [
        ['cantidad', 'Cantidad'],
        ['existencias', 'Existencias'],
        ['stock', 'Stock'],
        ['cantidad en stock', 'Cantidad en Stock'],
        ['cantidad disponible', 'Cantidad Disponible'],
        ['stock disponible', 'Stock Disponible'],
        ['stock actual', 'Stock Actual'],
        ['saldo de inventario', 'Saldo de Inventario'],
        ['unidades en existencia', 'Unidades en Existencia'],
        ['cantidad en existencias', 'Cantidad en Existencias']
      ],
      medium: [
        ['disponible', 'Disponible'],
        ['unidades', 'Unidades'],
        ['saldo', 'Saldo']
      ]
    },
    {
      kind: 'inventory',
      field: 'reorder_point',
      strong: [
        ['punto de pedido', 'Punto de Pedido'],
        ['punto de reorden', 'Punto de Reorden'],
        ['nivel de reposición', 'Nivel de Reposición'],
        ['stock mínimo', 'Stock Mínimo'],
        ['existencias mínimas', 'Existencias Mínimas'],
        ['punto de reposición', 'Punto de Reposición'],
        ['nivel mínimo', 'Nivel Mínimo']
      ],
      medium: [['stock de seguridad', 'Stock de Seguridad']]
    },
    {
      kind: 'inventory',
      field: 'unit_cost',
      strong: [
        ['costo unitario', 'Costo Unitario'],
        ['coste unitario', 'Coste Unitario'],
        ['precio unitario', 'Precio Unitario'],
        ['precio', 'Precio'],
        ['precio de compra', 'Precio de Compra'],
        ['costo por unidad', 'Costo por Unidad'],
        ['precio estándar', 'Precio Estándar'],
        ['costo estándar', 'Costo Estándar'],
        ['coste estándar', 'Coste Estándar']
      ]
    },
    {
      kind: 'inventory',
      field: 'avg_daily_usage',
      strong: [
        ['consumo diario promedio', 'Consumo Diario Promedio'],
        ['consumo diario medio', 'Consumo Diario Medio'],
        ['demanda diaria promedio', 'Demanda Diaria Promedio'],
        ['demanda diaria media', 'Demanda Diaria Media'],
        ['consumo promedio diario', 'Consumo Promedio Diario'],
        ['uso diario promedio', 'Uso Diario Promedio'],
        ['consumo diario', 'Consumo Diario']
      ]
    },
    {
      kind: 'inventory',
      field: 'lead_time_days',
      strong: [
        ['plazo de entrega', 'Plazo de Entrega (días)'],
        ['tiempo de entrega', 'Tiempo de Entrega'],
        ['tiempo de espera', 'Tiempo de Espera'],
        ['plazo de reposición', 'Plazo de Reposición'],
        ['plazo de aprovisionamiento', 'Plazo de Aprovisionamiento']
      ]
    },
    // ---- shipments ----
    {
      kind: 'shipments',
      field: 'shipment_id',
      strong: [
        ['número de envío', 'Número de Envío'],
        ['nº de envío', 'Nº de Envío'],
        ['número de guía', 'Número de Guía'],
        ['nº de guía', 'Nº de Guía'],
        ['guía', 'Guía'],
        ['guía de remisión', 'Guía de Remisión'],
        ['número de embarque', 'Número de Embarque'],
        ['id de envío', 'ID de Envío'],
        ['código de envío', 'Código de Envío'],
        ['número de expedición', 'Número de Expedición']
      ],
      medium: [
        ['número de seguimiento', 'Número de Seguimiento'],
        ['código de seguimiento', 'Código de Seguimiento'],
        ['número de tracking', 'Número de Tracking']
      ],
      weak: [
        ['número de pedido', 'Número de Pedido'],
        ['nº de pedido', 'Nº de Pedido'],
        ['pedido', 'Pedido'],
        ['número de orden', 'Número de Orden'],
        ['referencia', 'Referencia']
      ],
      note: 'may identify an order rather than a shipment'
    },
    {
      kind: 'shipments',
      field: 'origin',
      strong: [
        ['origen', 'Origen'],
        ['lugar de origen', 'Lugar de Origen'],
        ['ciudad de origen', 'Ciudad de Origen'],
        ['punto de origen', 'Punto de Origen'],
        ['origen del envío', 'Origen del Envío'],
        ['procedencia', 'Procedencia'],
        ['lugar de salida', 'Lugar de Salida'],
        ['punto de partida', 'Punto de Partida'],
        ['desde', 'Desde']
      ]
    },
    {
      kind: 'shipments',
      field: 'destination',
      strong: [
        ['destino', 'Destino'],
        ['lugar de destino', 'Lugar de Destino'],
        ['ciudad de destino', 'Ciudad de Destino'],
        ['punto de destino', 'Punto de Destino'],
        ['destino del envío', 'Destino del Envío'],
        ['punto de entrega', 'Punto de Entrega'],
        ['lugar de entrega', 'Lugar de Entrega'],
        ['hacia', 'Hacia']
      ]
    },
    {
      kind: 'shipments',
      field: 'carrier',
      strong: [
        ['transportista', 'Transportista'],
        ['transportador', 'Transportador'],
        ['empresa de transporte', 'Empresa de Transporte'],
        ['compañía de transporte', 'Compañía de Transporte'],
        ['operador logístico', 'Operador Logístico'],
        ['empresa transportista', 'Empresa Transportista'],
        ['agencia de transporte', 'Agencia de Transporte'],
        ['nombre del transportista', 'Nombre del Transportista'],
        ['proveedor de transporte', 'Proveedor de Transporte']
      ]
    },
    {
      kind: 'shipments',
      field: 'status',
      strong: [
        ['estado', 'Estado'],
        ['estado del envío', 'Estado del Envío'],
        ['estatus', 'Estatus'],
        ['estado de entrega', 'Estado de Entrega'],
        ['situación del envío', 'Situación del Envío']
      ],
      weak: [['estado del pedido', 'Estado del Pedido']]
    },
    {
      kind: 'shipments',
      field: 'ship_date',
      strong: [
        ['fecha de envío', 'Fecha de Envío'],
        ['fecha de salida', 'Fecha de Salida'],
        ['fecha de despacho', 'Fecha de Despacho'],
        ['fecha de expedición', 'Fecha de Expedición'],
        ['fecha de embarque', 'Fecha de Embarque'],
        ['fecha de recogida', 'Fecha de Recogida'],
        ['fecha de carga', 'Fecha de Carga']
      ]
    },
    {
      kind: 'shipments',
      field: 'estimated_delivery',
      strong: [
        ['fecha estimada de entrega', 'Fecha Estimada de Entrega'],
        ['fecha prevista de entrega', 'Fecha Prevista de Entrega'],
        ['fecha prevista', 'Fecha Prevista'],
        ['entrega estimada', 'Entrega Estimada'],
        ['entrega prevista', 'Entrega Prevista'],
        ['fecha programada de entrega', 'Fecha Programada de Entrega'],
        ['fecha de entrega prevista', 'Fecha de Entrega Prevista'],
        ['fecha de entrega estimada', 'Fecha de Entrega Estimada'],
        ['eta', 'ETA']
      ],
      medium: [['fecha compromiso de entrega', 'Fecha Compromiso de Entrega']]
    },
    {
      kind: 'shipments',
      field: 'actual_delivery',
      strong: [
        ['fecha de entrega real', 'Fecha de Entrega Real'],
        ['fecha real de entrega', 'Fecha Real de Entrega'],
        ['fecha de entrega', 'Fecha de Entrega'],
        ['fecha de recepción', 'Fecha de Recepción'],
        ['fecha entregado', 'Fecha Entregado'],
        ['entrega real', 'Entrega Real'],
        ['fecha de llegada real', 'Fecha de Llegada Real']
      ]
    },
    {
      kind: 'shipments',
      field: 'shipping_cost',
      strong: [
        ['costo de envío', 'Costo de Envío'],
        ['coste de envío', 'Coste de Envío'],
        ['costo de transporte', 'Costo de Transporte'],
        ['coste de transporte', 'Coste de Transporte'],
        ['importe del flete', 'Importe del Flete'],
        ['costo del flete', 'Costo del Flete'],
        ['flete', 'Flete'],
        ['importe de envío', 'Importe de Envío'],
        ['gastos de envío', 'Gastos de Envío'],
        ['tarifa de envío', 'Tarifa de Envío'],
        ['costo de flete', 'Costo de Flete']
      ]
    }
  ],
  ambiguous: [
    { kind: 'inventory', phrase: 'costo', example: 'Costo', candidates: ['unit_cost'] },
    { kind: 'inventory', phrase: 'coste', example: 'Coste', candidates: ['unit_cost'] },
    { kind: 'shipments', phrase: 'costo', example: 'Costo', candidates: ['shipping_cost'] },
    { kind: 'shipments', phrase: 'coste', example: 'Coste', candidates: ['shipping_cost'] },
    { kind: 'shipments', phrase: 'fecha', example: 'Fecha', candidates: ['ship_date', 'estimated_delivery', 'actual_delivery'] },
    { kind: 'shipments', phrase: 'ubicación', example: 'Ubicación', candidates: ['origin', 'destination'] }
  ]
};
