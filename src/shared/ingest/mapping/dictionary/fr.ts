// French header synonyms (accents are folded when matching). STATUS: needs native review. Rows are [phrase, example].

import type { DictionaryFile } from './index';

export const fr: DictionaryFile = {
  language: 'fr',
  reviewStatus: 'needs native review',
  version: '1.0.0',
  groups: [
    // ---- inventory ----
    {
      kind: 'inventory',
      field: 'sku',
      strong: [
        ['référence article', 'Référence Article'],
        ['code article', 'Code Article'],
        ['référence produit', 'Référence Produit'],
        ['code produit', 'Code Produit'],
        ["numéro d'article", "Numéro d'Article"],
        ['numéro article', 'Numéro Article'],
        ['réf article', 'Réf. Article'],
        ['code sku', 'Code SKU'],
        ['n° article', 'N° Article'],
        ['numéro de pièce', 'Numéro de Pièce']
      ],
      medium: [['référence', 'Référence']]
    },
    {
      kind: 'inventory',
      field: 'product_name',
      strong: [
        ['désignation', 'Désignation'],
        ['désignation article', 'Désignation Article'],
        ['libellé article', 'Libellé Article'],
        ['libellé produit', 'Libellé Produit'],
        ['nom du produit', 'Nom du Produit'],
        ["nom de l'article", "Nom de l'Article"],
        ['description du produit', 'Description du Produit'],
        ['description article', 'Description Article'],
        ['libellé', 'Libellé']
      ],
      medium: [
        ['description', 'Description'],
        ['produit', 'Produit'],
        ['article', 'Article']
      ]
    },
    {
      kind: 'inventory',
      field: 'category',
      strong: [
        ['catégorie', 'Catégorie'],
        ['catégorie produit', 'Catégorie Produit'],
        ["catégorie d'article", "Catégorie d'Article"],
        ["famille d'articles", "Famille d'Articles"],
        ['famille de produits', 'Famille de Produits'],
        ['famille produit', 'Famille Produit'],
        ["groupe d'articles", "Groupe d'Articles"],
        ['groupe de marchandises', 'Groupe de Marchandises']
      ],
      medium: [
        ['famille', 'Famille'],
        ['groupe', 'Groupe'],
        ['rayon', 'Rayon']
      ]
    },
    {
      kind: 'inventory',
      field: 'warehouse',
      strong: [
        ['entrepôt', 'Entrepôt'],
        ['code entrepôt', 'Code Entrepôt'],
        ['dépôt', 'Dépôt'],
        ['site de stockage', 'Site de Stockage'],
        ['magasin', 'Magasin'],
        ['emplacement de stockage', 'Emplacement de Stockage'],
        ['centre de distribution', 'Centre de Distribution'],
        ["nom de l'entrepôt", "Nom de l'Entrepôt"]
      ],
      medium: [
        ['site', 'Site'],
        ['emplacement', 'Emplacement']
      ]
    },
    {
      kind: 'inventory',
      field: 'quantity',
      strong: [
        ['quantité', 'Quantité'],
        ['quantité en stock', 'Quantité en Stock'],
        ['stock disponible', 'Stock Disponible'],
        ['stock', 'Stock'],
        ['stock actuel', 'Stock Actuel'],
        ['quantité disponible', 'Quantité Disponible'],
        ['qté', 'Qté'],
        ['qte', 'QTE']
      ],
      medium: [['disponible', 'Disponible']]
    },
    {
      kind: 'inventory',
      field: 'reorder_point',
      strong: [
        ['seuil de réapprovisionnement', 'Seuil de Réapprovisionnement'],
        ['point de commande', 'Point de Commande'],
        ['seuil de commande', 'Seuil de Commande'],
        ['stock minimum', 'Stock Minimum'],
        ['stock mini', 'Stock Mini'],
        ['point de réapprovisionnement', 'Point de Réapprovisionnement'],
        ['niveau de réapprovisionnement', 'Niveau de Réapprovisionnement'],
        ['seuil de réassort', 'Seuil de Réassort']
      ],
      medium: [
        ['stock de sécurité', 'Stock de Sécurité'],
        ['seuil', 'Seuil']
      ]
    },
    {
      kind: 'inventory',
      field: 'unit_cost',
      strong: [
        ['prix unitaire', 'Prix Unitaire'],
        ['coût unitaire', 'Coût Unitaire'],
        ["prix d'achat unitaire", "Prix d'Achat Unitaire"],
        ["prix d'achat", "Prix d'Achat"],
        ["coût d'achat", "Coût d'Achat"],
        ['prix standard', 'Prix Standard'],
        ['coût standard', 'Coût Standard'],
        ['pu', 'PU'],
        ['prix', 'Prix'],
        ['prix de revient unitaire', 'Prix de Revient Unitaire']
      ]
    },
    {
      kind: 'inventory',
      field: 'avg_daily_usage',
      strong: [
        ['consommation journalière moyenne', 'Consommation Journalière Moyenne'],
        ['consommation moyenne journalière', 'Consommation Moyenne Journalière'],
        ['consommation quotidienne moyenne', 'Consommation Quotidienne Moyenne'],
        ['demande journalière moyenne', 'Demande Journalière Moyenne'],
        ['consommation journalière', 'Consommation Journalière'],
        ['demande quotidienne moyenne', 'Demande Quotidienne Moyenne'],
        ['consommation par jour', 'Consommation par Jour']
      ]
    },
    {
      kind: 'inventory',
      field: 'lead_time_days',
      strong: [
        ["délai d'approvisionnement", "Délai d'Approvisionnement (jours)"],
        ['délai de livraison fournisseur', 'Délai de Livraison Fournisseur'],
        ['délai de réapprovisionnement', 'Délai de Réapprovisionnement'],
        ['délai fournisseur', 'Délai Fournisseur'],
        ["délai d'obtention", "Délai d'Obtention"]
      ],
      medium: [
        ['délai', 'Délai'],
        ['délai de livraison', 'Délai de Livraison']
      ]
    },
    // ---- shipments ----
    {
      kind: 'shipments',
      field: 'shipment_id',
      strong: [
        ["numéro d'expédition", "Numéro d'Expédition"],
        ["n° d'expédition", "N° d'Expédition"],
        ['lettre de voiture', 'Lettre de Voiture'],
        ['numéro de lettre de voiture', 'Numéro de Lettre de Voiture'],
        ["numéro d'envoi", "Numéro d'Envoi"],
        ["n° d'envoi", "N° d'Envoi"],
        ['id expédition', 'ID Expédition'],
        ["référence d'expédition", "Référence d'Expédition"]
      ],
      medium: [
        ['numéro de suivi', 'Numéro de Suivi'],
        ['n° de suivi', 'N° de Suivi'],
        ['numéro de tracking', 'Numéro de Tracking'],
        ['code de suivi', 'Code de Suivi'],
        ['numéro de colis', 'Numéro de Colis'],
        ['numéro de livraison', 'Numéro de Livraison']
      ],
      weak: [
        ['numéro de commande', 'Numéro de Commande'],
        ['n° de commande', 'N° de Commande'],
        ['référence', 'Référence'],
        ['réf', 'Réf']
      ],
      note: 'may identify an order rather than a shipment'
    },
    {
      kind: 'shipments',
      field: 'origin',
      strong: [
        ['origine', 'Origine'],
        ["lieu d'origine", "Lieu d'Origine"],
        ['ville de départ', 'Ville de Départ'],
        ['lieu de départ', 'Lieu de Départ'],
        ['point de départ', 'Point de Départ'],
        ['départ', 'Départ'],
        ['provenance', 'Provenance'],
        ["ville d'origine", "Ville d'Origine"],
        ["site d'origine", "Site d'Origine"],
        ["lieu d'expédition", "Lieu d'Expédition"]
      ]
    },
    {
      kind: 'shipments',
      field: 'destination',
      strong: [
        ['destination', 'Destination'],
        ['lieu de destination', 'Lieu de Destination'],
        ["ville d'arrivée", "Ville d'Arrivée"],
        ["lieu d'arrivée", "Lieu d'Arrivée"],
        ["point d'arrivée", "Point d'Arrivée"],
        ['arrivée', 'Arrivée'],
        ['ville de destination', 'Ville de Destination'],
        ['lieu de livraison', 'Lieu de Livraison'],
        ['point de livraison', 'Point de Livraison'],
        ['vers', 'Vers']
      ]
    },
    {
      kind: 'shipments',
      field: 'carrier',
      strong: [
        ['transporteur', 'Transporteur'],
        ['nom du transporteur', 'Nom du Transporteur'],
        ['société de transport', 'Société de Transport'],
        ['compagnie de transport', 'Compagnie de Transport'],
        ['prestataire de transport', 'Prestataire de Transport'],
        ['prestataire logistique', 'Prestataire Logistique'],
        ['affréteur', 'Affréteur'],
        ['messagerie', 'Messagerie'],
        ['entreprise de transport', 'Entreprise de Transport']
      ]
    },
    {
      kind: 'shipments',
      field: 'status',
      strong: [
        ['statut', 'Statut'],
        ["statut de l'expédition", "Statut de l'Expédition"],
        ['statut de livraison', 'Statut de Livraison'],
        ['état', 'État'],
        ["état de l'expédition", "État de l'Expédition"],
        ["statut d'envoi", "Statut d'Envoi"],
        ['état de livraison', 'État de Livraison']
      ],
      weak: [['statut commande', 'Statut Commande']]
    },
    {
      kind: 'shipments',
      field: 'ship_date',
      strong: [
        ["date d'expédition", "Date d'Expédition"],
        ["date d'envoi", "Date d'Envoi"],
        ['date de départ', 'Date de Départ'],
        ["date d'enlèvement", "Date d'Enlèvement"],
        ['date de chargement', 'Date de Chargement'],
        ['date de ramassage', 'Date de Ramassage']
      ]
    },
    {
      kind: 'shipments',
      field: 'estimated_delivery',
      strong: [
        ['date de livraison prévue', 'Date de Livraison Prévue'],
        ['date de livraison prévisionnelle', 'Date de Livraison Prévisionnelle'],
        ['livraison prévue', 'Livraison Prévue'],
        ['date prévue de livraison', 'Date Prévue de Livraison'],
        ['date de livraison estimée', 'Date de Livraison Estimée'],
        ['livraison estimée', 'Livraison Estimée'],
        ["date d'arrivée prévue", "Date d'Arrivée Prévue"],
        ['date prévue', 'Date Prévue'],
        ['eta', 'ETA']
      ],
      medium: [['date de livraison souhaitée', 'Date de Livraison Souhaitée']]
    },
    {
      kind: 'shipments',
      field: 'actual_delivery',
      strong: [
        ['date de livraison réelle', 'Date de Livraison Réelle'],
        ['date de livraison effective', 'Date de Livraison Effective'],
        ['date de livraison', 'Date de Livraison'],
        ['date de réception', 'Date de Réception'],
        ["date d'arrivée réelle", "Date d'Arrivée Réelle"],
        ['livraison effective', 'Livraison Effective']
      ]
    },
    {
      kind: 'shipments',
      field: 'shipping_cost',
      strong: [
        ['coût du transport', 'Coût du Transport'],
        ['frais de port', 'Frais de Port'],
        ['frais de transport', 'Frais de Transport'],
        ["coût d'expédition", "Coût d'Expédition"],
        ["frais d'expédition", "Frais d'Expédition"],
        ['coût de transport', 'Coût de Transport'],
        ['coût de livraison', 'Coût de Livraison'],
        ['frais de livraison', 'Frais de Livraison'],
        ['prix du transport', 'Prix du Transport'],
        ['tarif de transport', 'Tarif de Transport'],
        ['montant du fret', 'Montant du Fret'],
        ['fret', 'Fret'],
        ['coût du fret', 'Coût du Fret']
      ]
    }
  ],
  ambiguous: [
    { kind: 'inventory', phrase: 'coût', example: 'Coût', candidates: ['unit_cost'] },
    { kind: 'shipments', phrase: 'coût', example: 'Coût', candidates: ['shipping_cost'] },
    { kind: 'shipments', phrase: 'frais', example: 'Frais', candidates: ['shipping_cost'] },
    { kind: 'shipments', phrase: 'date', example: 'Date', candidates: ['ship_date', 'estimated_delivery', 'actual_delivery'] },
    { kind: 'shipments', phrase: 'lieu', example: 'Lieu', candidates: ['origin', 'destination'] }
  ]
};
