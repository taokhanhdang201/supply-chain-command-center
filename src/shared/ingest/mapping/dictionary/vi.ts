// Vietnamese header synonyms (diacritics are folded when matching, so "Mã hàng", "ma hang" and "MÃ HÀNG" are the same).
// STATUS: needs native review (the dataset owner reviews Vietnamese). Rows are [phrase, example].

import type { DictionaryFile } from './index';

export const vi: DictionaryFile = {
  language: 'vi',
  reviewStatus: 'needs native review',
  version: '1.0.0',
  groups: [
    // ---- inventory ----
    {
      kind: 'inventory',
      field: 'sku',
      strong: [
        ['mã hàng', 'Mã hàng'],
        ['mã sản phẩm', 'Mã sản phẩm'],
        ['mã vật tư', 'Mã vật tư'],
        ['mã hàng hóa', 'Mã hàng hóa'],
        ['mã sku', 'Mã SKU'],
        ['mã số hàng', 'Mã số hàng'],
        ['mã sp', 'Mã SP']
      ],
      medium: [['mã', 'Mã']]
    },
    {
      kind: 'inventory',
      field: 'product_name',
      strong: [
        ['tên sản phẩm', 'Tên sản phẩm'],
        ['tên hàng', 'Tên hàng'],
        ['tên hàng hóa', 'Tên hàng hóa'],
        ['tên vật tư', 'Tên vật tư'],
        ['mô tả sản phẩm', 'Mô tả sản phẩm'],
        ['tên sp', 'Tên SP']
      ],
      medium: [
        ['sản phẩm', 'Sản phẩm'],
        ['mô tả', 'Mô tả']
      ]
    },
    {
      kind: 'inventory',
      field: 'category',
      strong: [
        ['nhóm hàng', 'Nhóm hàng'],
        ['loại hàng', 'Loại hàng'],
        ['danh mục', 'Danh mục'],
        ['nhóm sản phẩm', 'Nhóm sản phẩm'],
        ['danh mục sản phẩm', 'Danh mục sản phẩm'],
        ['ngành hàng', 'Ngành hàng']
      ],
      medium: [
        ['nhóm', 'Nhóm'],
        ['loại', 'Loại']
      ]
    },
    {
      kind: 'inventory',
      field: 'warehouse',
      strong: [
        ['kho', 'Kho'],
        ['kho hàng', 'Kho hàng'],
        ['mã kho', 'Mã kho'],
        ['tên kho', 'Tên kho'],
        ['kho lưu trữ', 'Kho lưu trữ']
      ],
      medium: [['địa điểm', 'Địa điểm']]
    },
    {
      kind: 'inventory',
      field: 'quantity',
      strong: [
        ['số lượng', 'Số lượng'],
        ['tồn kho', 'Tồn kho'],
        ['số lượng tồn', 'Số lượng tồn'],
        ['tồn kho hiện tại', 'Tồn kho hiện tại'],
        ['số lượng tồn kho', 'Số lượng tồn kho'],
        ['sl tồn', 'SL tồn']
      ],
      medium: [
        ['tồn', 'Tồn'],
        ['số lượng hiện có', 'Số lượng hiện có'],
        ['sl', 'SL']
      ]
    },
    {
      kind: 'inventory',
      field: 'reorder_point',
      strong: [
        ['mức đặt hàng lại', 'Mức đặt hàng lại'],
        ['điểm đặt hàng lại', 'Điểm đặt hàng lại'],
        ['điểm đặt hàng', 'Điểm đặt hàng'],
        ['mức tồn tối thiểu', 'Mức tồn tối thiểu'],
        ['tồn tối thiểu', 'Tồn tối thiểu'],
        ['tồn kho tối thiểu', 'Tồn kho tối thiểu'],
        ['mức tái đặt hàng', 'Mức tái đặt hàng']
      ],
      medium: [
        ['tối thiểu', 'Tối thiểu'],
        ['mức tồn an toàn', 'Mức tồn an toàn']
      ]
    },
    {
      kind: 'inventory',
      field: 'unit_cost',
      strong: [
        ['đơn giá', 'Đơn giá'],
        ['giá', 'Giá'],
        ['giá vốn', 'Giá vốn'],
        ['giá vốn đơn vị', 'Giá vốn đơn vị'],
        ['giá nhập', 'Giá nhập'],
        ['giá mua', 'Giá mua'],
        ['giá đơn vị', 'Giá đơn vị'],
        ['đơn giá vốn', 'Đơn giá vốn']
      ]
    },
    {
      kind: 'inventory',
      field: 'avg_daily_usage',
      strong: [
        ['mức tiêu thụ trung bình ngày', 'Mức tiêu thụ trung bình ngày'],
        ['tiêu thụ trung bình ngày', 'Tiêu thụ trung bình ngày'],
        ['nhu cầu trung bình ngày', 'Nhu cầu trung bình ngày'],
        ['lượng xuất trung bình ngày', 'Lượng xuất trung bình ngày'],
        ['mức sử dụng trung bình ngày', 'Mức sử dụng trung bình ngày'],
        ['tiêu thụ hàng ngày', 'Tiêu thụ hàng ngày']
      ]
    },
    {
      kind: 'inventory',
      field: 'lead_time_days',
      strong: [
        ['thời gian giao hàng', 'Thời gian giao hàng (ngày)'],
        ['thời gian chờ', 'Thời gian chờ'],
        ['thời gian đặt hàng', 'Thời gian đặt hàng'],
        ['thời gian cung ứng', 'Thời gian cung ứng'],
        ['thời gian nhập hàng', 'Thời gian nhập hàng']
      ]
    },
    // ---- shipments ----
    {
      kind: 'shipments',
      field: 'shipment_id',
      strong: [
        ['mã vận đơn', 'Mã vận đơn'],
        ['số vận đơn', 'Số vận đơn'],
        ['mã lô hàng', 'Mã lô hàng'],
        ['số lô hàng', 'Số lô hàng'],
        ['mã chuyến hàng', 'Mã chuyến hàng'],
        ['mã đơn vận chuyển', 'Mã đơn vận chuyển'],
        ['số vận chuyển', 'Số vận chuyển'],
        ['mã lệnh giao', 'Mã lệnh giao']
      ],
      medium: [
        ['mã tracking', 'Mã tracking'],
        ['mã theo dõi', 'Mã theo dõi'],
        ['số theo dõi', 'Số theo dõi'],
        ['mã tra cứu', 'Mã tra cứu']
      ],
      weak: [
        ['mã đơn hàng', 'Mã đơn hàng'],
        ['số đơn hàng', 'Số đơn hàng'],
        ['số tham chiếu', 'Số tham chiếu'],
        ['mã tham chiếu', 'Mã tham chiếu']
      ],
      note: 'may identify an order rather than a shipment'
    },
    {
      kind: 'shipments',
      field: 'origin',
      strong: [
        ['nơi gửi', 'Nơi gửi'],
        ['nơi đi', 'Nơi đi'],
        ['điểm đi', 'Điểm đi'],
        ['điểm gửi', 'Điểm gửi'],
        ['nơi xuất phát', 'Nơi xuất phát'],
        ['địa điểm gửi', 'Địa điểm gửi'],
        ['nơi gửi hàng', 'Nơi gửi hàng']
      ]
    },
    {
      kind: 'shipments',
      field: 'destination',
      strong: [
        ['nơi nhận', 'Nơi nhận'],
        ['nơi đến', 'Nơi đến'],
        ['điểm đến', 'Điểm đến'],
        ['điểm nhận', 'Điểm nhận'],
        ['địa điểm nhận', 'Địa điểm nhận'],
        ['nơi giao', 'Nơi giao'],
        ['nơi nhận hàng', 'Nơi nhận hàng']
      ]
    },
    {
      kind: 'shipments',
      field: 'carrier',
      strong: [
        ['đơn vị vận chuyển', 'Đơn vị vận chuyển'],
        ['nhà vận chuyển', 'Nhà vận chuyển'],
        ['nhà xe', 'Nhà xe'],
        ['hãng vận chuyển', 'Hãng vận chuyển'],
        ['công ty vận chuyển', 'Công ty vận chuyển'],
        ['nhà vận tải', 'Nhà vận tải'],
        ['đơn vị vận tải', 'Đơn vị vận tải'],
        ['tên nhà vận chuyển', 'Tên nhà vận chuyển']
      ]
    },
    {
      kind: 'shipments',
      field: 'status',
      strong: [
        ['trạng thái', 'Trạng thái'],
        ['trạng thái đơn', 'Trạng thái đơn'],
        ['trạng thái giao hàng', 'Trạng thái giao hàng'],
        ['tình trạng', 'Tình trạng'],
        ['tình trạng giao hàng', 'Tình trạng giao hàng'],
        ['trạng thái vận đơn', 'Trạng thái vận đơn']
      ],
      weak: [['tình trạng đơn hàng', 'Tình trạng đơn hàng']]
    },
    {
      kind: 'shipments',
      field: 'ship_date',
      strong: [
        ['ngày gửi hàng', 'Ngày gửi hàng'],
        ['ngày gửi', 'Ngày gửi'],
        ['ngày xuất kho', 'Ngày xuất kho'],
        ['ngày xuất hàng', 'Ngày xuất hàng'],
        ['ngày vận chuyển', 'Ngày vận chuyển'],
        ['ngày đi', 'Ngày đi'],
        ['ngày lấy hàng', 'Ngày lấy hàng']
      ]
    },
    {
      kind: 'shipments',
      field: 'estimated_delivery',
      strong: [
        ['ngày giao dự kiến', 'Ngày giao dự kiến'],
        ['ngày giao hàng dự kiến', 'Ngày giao hàng dự kiến'],
        ['dự kiến giao', 'Dự kiến giao'],
        ['ngày dự kiến giao', 'Ngày dự kiến giao'],
        ['ngày đến dự kiến', 'Ngày đến dự kiến'],
        ['ngày giao theo kế hoạch', 'Ngày giao theo kế hoạch']
      ],
      medium: [
        ['hạn giao hàng', 'Hạn giao hàng'],
        ['ngày hẹn giao', 'Ngày hẹn giao']
      ]
    },
    {
      kind: 'shipments',
      field: 'actual_delivery',
      strong: [
        ['ngày giao thực tế', 'Ngày giao thực tế'],
        ['ngày giao hàng thực tế', 'Ngày giao hàng thực tế'],
        ['ngày giao hàng', 'Ngày giao hàng'],
        ['ngày nhận hàng', 'Ngày nhận hàng'],
        ['ngày đã giao', 'Ngày đã giao'],
        ['ngày giao', 'Ngày giao'],
        ['ngày giao thành công', 'Ngày giao thành công']
      ]
    },
    {
      kind: 'shipments',
      field: 'shipping_cost',
      strong: [
        ['cước phí', 'Cước phí'],
        ['cước vận chuyển', 'Cước vận chuyển'],
        ['phí vận chuyển', 'Phí vận chuyển'],
        ['chi phí vận chuyển', 'Chi phí vận chuyển'],
        ['phí giao hàng', 'Phí giao hàng'],
        ['tiền cước', 'Tiền cước'],
        ['chi phí giao hàng', 'Chi phí giao hàng'],
        ['phí vận tải', 'Phí vận tải']
      ],
      medium: [['cước', 'Cước']]
    }
  ],
  ambiguous: [
    { kind: 'inventory', phrase: 'chi phí', example: 'Chi phí', candidates: ['unit_cost'] },
    { kind: 'shipments', phrase: 'chi phí', example: 'Chi phí', candidates: ['shipping_cost'] },
    { kind: 'shipments', phrase: 'ngày', example: 'Ngày', candidates: ['ship_date', 'estimated_delivery', 'actual_delivery'] },
    { kind: 'shipments', phrase: 'địa điểm', example: 'Địa điểm', candidates: ['origin', 'destination'] }
  ]
};
