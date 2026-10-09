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
};

export type ListingPage = {
  // Listings on this page. `job` is present when the listing already carries
  // the full record (API sources); otherwise `detail` is called for new ones.
  items: Array<{ id: string; url: string; job?: CareerJob }>;
};

export interface Adapter {
  slug: string;
  // True when list() always returns every open job (e.g. a sitemap). False when
  // it pages newest-first and can stop early on an incremental run.
  alwaysComplete: boolean;
  list(budget: Budget, full: boolean): AsyncGenerator<ListingPage>;
  detail?(item: { id: string; url: string }, budget: Budget): Promise<CareerJob | null>;
}
