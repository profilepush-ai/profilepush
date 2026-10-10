import type { Budget } from "./http";

export type CareerJob = {
  source_id: string;
  url: string;
  title: string;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  remote?: boolean | null;
  employment_type?: string | null;
  date_posted?: string | null;
  pay_min?: number | null;
  pay_max?: number | null;
  pay_unit?: string | null;
  currency?: string | null;
  description?: string | null;
  // Job boards: the employer behind this job (a firm's own site leaves it
  // empty: the firm is the poster) and the board it came through.
  company?: string | null;
  via?: string | null;
};

export type ListingItem = {
  id: string;
  url: string;
  // Listing title, when known before the detail fetch: lets clearly non-IT
  // jobs be skipped without fetching their pages.
  title?: string;
  job?: CareerJob;
  // Adapter-specific data carried from the listing to detail().
  extra?: unknown;
};

export type ListingPage = {
  // Listings on this page. `job` is present when the listing already carries
  // the full record (API sources); otherwise `detail` is called for new ones.
  items: Array<ListingItem>;
  // Some listings could not be read: the run must not close missing jobs.
  partial?: boolean;
  // How many open jobs the site lists in all, when it says.
  total?: number;
};

export interface Adapter {
  slug: string;
  // True when list() always returns every open job (e.g. a sitemap). False when
  // it pages newest-first and can stop early on an incremental run.
  alwaysComplete: boolean;
  list(budget: Budget, full: boolean): AsyncGenerator<ListingPage>;
  detail?(item: ListingItem, budget: Budget): Promise<CareerJob | null>;
}
