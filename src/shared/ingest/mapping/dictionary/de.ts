// German header synonyms (umlauts and sharp s are folded when matching). STATUS: needs native review. Rows are [phrase, example].

import type { DictionaryFile } from './index';

export const de: DictionaryFile = {
  language: 'de',
  reviewStatus: 'needs native review',
  version: '1.0.0',
  groups: [
    // ---- inventory ----
    {
      kind: 'inventory',
      field: 'sku',
      strong: [
        ['artikelnummer', 'Artikelnummer'],
        ['artikelnr', 'Artikelnr.'],
        ['artikel-nr', 'Artikel-Nr.'],
        ['materialnummer', 'Materialnummer'],
        ['materialnr', 'Materialnr.'],
        ['teilenummer', 'Teilenummer'],
        ['produktnummer', 'Produktnummer'],
        ['artikelcode', 'Artikelcode']
      ],
      medium: [
        ['artikel', 'Artikel'],
        ['material', 'Material']
      ]
    },
    {
      kind: 'inventory',
      field: 'product_name',
      strong: [
        ['artikelbezeichnung', 'Artikelbezeichnung'],
        ['artikelbeschreibung', 'Artikelbeschreibung'],
        ['produktbezeichnung', 'Produktbezeichnung'],
        ['produktname', 'Produktname'],
        ['materialbezeichnung', 'Materialbezeichnung'],
        ['materialkurztext', 'Materialkurztext'],
        ['artikelname', 'Artikelname'],
        ['bezeichnung', 'Bezeichnung']
      ],
      medium: [
        ['beschreibung', 'Beschreibung'],
        ['produkt', 'Produkt']
      ]
    },
    {
      kind: 'inventory',
      field: 'category',
      strong: [
        ['warengruppe', 'Warengruppe'],
        ['produktkategorie', 'Produktkategorie'],
        ['artikelgruppe', 'Artikelgruppe'],
        ['materialgruppe', 'Materialgruppe'],
        ['produktgruppe', 'Produktgruppe'],
        ['kategorie', 'Kategorie'],
        ['artikelkategorie', 'Artikelkategorie']
      ],
      medium: [['gruppe', 'Gruppe']]
    },
    {
      kind: 'inventory',
      field: 'warehouse',
      strong: [
        ['lager', 'Lager'],
        ['lagerort', 'Lagerort'],
        ['lagernummer', 'Lagernummer'],
        ['lagerhaus', 'Lagerhaus'],
        ['lagerstandort', 'Lagerstandort'],
        ['werk', 'Werk']
      ],
      medium: [
        ['standort', 'Standort'],
        ['niederlassung', 'Niederlassung']
      ]
    },
    {
      kind: 'inventory',
      field: 'quantity',
      strong: [
        ['lagerbestand', 'Lagerbestand'],
        ['bestand', 'Bestand'],
        ['menge', 'Menge'],
        ['bestandsmenge', 'Bestandsmenge'],
        ['verfügbarer bestand', 'Verfügbarer Bestand'],
        ['aktueller bestand', 'Aktueller Bestand'],
        ['verfügbare menge', 'Verfügbare Menge'],
        ['frei verwendbarer bestand', 'Frei verwendbarer Bestand'],
        ['menge auf lager', 'Menge auf Lager']
      ],
      medium: [
        ['stückzahl', 'Stückzahl'],
        ['anzahl', 'Anzahl']
      ]
    },
    {
      kind: 'inventory',
      field: 'reorder_point',
      strong: [
        ['meldebestand', 'Meldebestand'],
        ['bestellpunkt', 'Bestellpunkt'],
        ['mindestbestand', 'Mindestbestand'],
        ['nachbestellpunkt', 'Nachbestellpunkt'],
        ['bestellbestand', 'Bestellbestand'],
        ['wiederbeschaffungspunkt', 'Wiederbeschaffungspunkt']
      ],
      medium: [['sicherheitsbestand', 'Sicherheitsbestand']]
    },
    {
      kind: 'inventory',
      field: 'unit_cost',
      strong: [
        ['einkaufspreis', 'Einkaufspreis'],
        ['stückpreis', 'Stückpreis'],
        ['einzelpreis', 'Einzelpreis'],
        ['stückkosten', 'Stückkosten'],
        ['einstandspreis', 'Einstandspreis'],
        ['standardpreis', 'Standardpreis'],
        ['preis pro stück', 'Preis pro Stück'],
        ['einzelkosten', 'Einzelkosten'],
        ['preis', 'Preis']
      ]
    },
    {
      kind: 'inventory',
      field: 'avg_daily_usage',
      strong: [
        ['durchschnittlicher tagesverbrauch', 'Durchschnittlicher Tagesverbrauch'],
        ['tagesverbrauch', 'Tagesverbrauch'],
        ['durchschnittsverbrauch pro tag', 'Durchschnittsverbrauch pro Tag'],
        ['täglicher verbrauch', 'Täglicher Verbrauch'],
        ['durchschnittlicher täglicher verbrauch', 'Durchschnittlicher täglicher Verbrauch'],
        ['tagesbedarf', 'Tagesbedarf'],
        ['durchschnittlicher tagesbedarf', 'Durchschnittlicher Tagesbedarf'],
        ['durchschnittsverbrauch', 'Durchschnittsverbrauch']
      ]
    },
    {
      kind: 'inventory',
      field: 'lead_time_days',
      strong: [
        ['wiederbeschaffungszeit', 'Wiederbeschaffungszeit (Tage)'],
        ['lieferzeit', 'Lieferzeit'],
        ['beschaffungszeit', 'Beschaffungszeit'],
        ['wbz', 'WBZ'],
        ['planlieferzeit', 'Planlieferzeit'],
        ['lieferfrist', 'Lieferfrist']
      ]
    },
    // ---- shipments ----
    {
      kind: 'shipments',
      field: 'shipment_id',
      strong: [
        ['sendungsnummer', 'Sendungsnummer'],
        ['sendungsnr', 'Sendungsnr.'],
        ['sendungs-nr', 'Sendungs-Nr.'],
        ['frachtbriefnummer', 'Frachtbriefnummer'],
        ['frachtbrief-nr', 'Frachtbrief-Nr.'],
        ['ladungsnummer', 'Ladungsnummer'],
        ['transportnummer', 'Transportnummer']
      ],
      medium: [
        ['trackingnummer', 'Trackingnummer'],
        ['tracking-nummer', 'Tracking-Nummer'],
        ['sendungsverfolgungsnummer', 'Sendungsverfolgungsnummer'],
        ['paketnummer', 'Paketnummer'],
        ['lieferungsnummer', 'Lieferungsnummer'],
        ['lieferscheinnummer', 'Lieferscheinnummer']
      ],
      weak: [
        ['auftragsnummer', 'Auftragsnummer'],
        ['bestellnummer', 'Bestellnummer'],
        ['referenznummer', 'Referenznummer']
      ],
      note: 'may identify an order rather than a shipment'
    },
    {
      kind: 'shipments',
      field: 'origin',
      strong: [
        ['versandort', 'Versandort'],
        ['abgangsort', 'Abgangsort'],
        ['ursprungsort', 'Ursprungsort'],
        ['herkunftsort', 'Herkunftsort'],
        ['startort', 'Startort'],
        ['von', 'Von'],
        ['abholort', 'Abholort'],
        ['ausgangsort', 'Ausgangsort']
      ],
      medium: [['absender', 'Absender']]
    },
    {
      kind: 'shipments',
      field: 'destination',
      strong: [
        ['lieferort', 'Lieferort'],
        ['zielort', 'Zielort'],
        ['bestimmungsort', 'Bestimmungsort'],
        ['empfangsort', 'Empfangsort'],
        ['nach', 'Nach'],
        ['ziel', 'Ziel']
      ],
      medium: [['empfänger', 'Empfänger']]
    },
    {
      kind: 'shipments',
      field: 'carrier',
      strong: [
        ['spediteur', 'Spediteur'],
        ['frachtführer', 'Frachtführer'],
        ['transporteur', 'Transporteur'],
        ['versanddienstleister', 'Versanddienstleister'],
        ['logistikdienstleister', 'Logistikdienstleister'],
        ['transportunternehmen', 'Transportunternehmen'],
        ['frachtunternehmen', 'Frachtunternehmen'],
        ['paketdienst', 'Paketdienst'],
        ['spedition', 'Spedition']
      ]
    },
    {
      kind: 'shipments',
      field: 'status',
      strong: [
        ['sendungsstatus', 'Sendungsstatus'],
        ['status', 'Status'],
        ['lieferstatus', 'Lieferstatus'],
        ['transportstatus', 'Transportstatus']
      ],
      weak: [['auftragsstatus', 'Auftragsstatus']]
    },
    {
      kind: 'shipments',
      field: 'ship_date',
      strong: [
        ['versanddatum', 'Versanddatum'],
        ['abgangsdatum', 'Abgangsdatum'],
        ['abholdatum', 'Abholdatum'],
        ['absendedatum', 'Absendedatum'],
        ['verladedatum', 'Verladedatum'],
        ['abfahrtsdatum', 'Abfahrtsdatum'],
        ['versand am', 'Versand am']
      ]
    },
    {
      kind: 'shipments',
      field: 'estimated_delivery',
      strong: [
        ['voraussichtliche lieferung', 'Voraussichtliche Lieferung'],
        ['voraussichtliches lieferdatum', 'Voraussichtliches Lieferdatum'],
        ['geplantes lieferdatum', 'Geplantes Lieferdatum'],
        ['liefertermin', 'Liefertermin'],
        ['erwartetes lieferdatum', 'Erwartetes Lieferdatum'],
        ['geplante lieferung', 'Geplante Lieferung'],
        ['soll-lieferdatum', 'Soll-Lieferdatum'],
        ['eta', 'ETA']
      ],
      medium: [['wunschliefertermin', 'Wunschliefertermin']]
    },
    {
      kind: 'shipments',
      field: 'actual_delivery',
      strong: [
        ['lieferdatum', 'Lieferdatum'],
        ['zustelldatum', 'Zustelldatum'],
        ['tatsächliches lieferdatum', 'Tatsächliches Lieferdatum'],
        ['ist-lieferdatum', 'Ist-Lieferdatum'],
        ['zugestellt am', 'Zugestellt am'],
        ['ankunftsdatum', 'Ankunftsdatum'],
        ['wareneingangsdatum', 'Wareneingangsdatum'],
        ['tatsächliche lieferung', 'Tatsächliche Lieferung']
      ]
    },
    {
      kind: 'shipments',
      field: 'shipping_cost',
      strong: [
        ['frachtkosten', 'Frachtkosten'],
        ['versandkosten', 'Versandkosten'],
        ['transportkosten', 'Transportkosten'],
        ['frachtpreis', 'Frachtpreis'],
        ['frachtgebühr', 'Frachtgebühr'],
        ['frachtgebühren', 'Frachtgebühren'],
        ['lieferkosten', 'Lieferkosten'],
        ['fracht', 'Fracht'],
        ['frachtbetrag', 'Frachtbetrag'],
        ['portokosten', 'Portokosten']
      ]
    }
  ],
  ambiguous: [
    { kind: 'inventory', phrase: 'kosten', example: 'Kosten', candidates: ['unit_cost'] },
    { kind: 'inventory', phrase: 'verbrauch', example: 'Verbrauch', candidates: ['avg_daily_usage'] },
    { kind: 'shipments', phrase: 'kosten', example: 'Kosten', candidates: ['shipping_cost'] },
    { kind: 'shipments', phrase: 'datum', example: 'Datum', candidates: ['ship_date', 'estimated_delivery', 'actual_delivery'] },
    { kind: 'shipments', phrase: 'ort', example: 'Ort', candidates: ['origin', 'destination'] }
  ]
};
