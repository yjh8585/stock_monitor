export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      board_sentiment: {
        Row: {
          analyzed_at: string;
          company_id: string;
          label: string;
          model: string;
          post_id: string;
          reason: string | null;
          score: number | null;
        };
        Insert: {
          analyzed_at?: string;
          company_id: string;
          label: string;
          model: string;
          post_id: string;
          reason?: string | null;
          score?: number | null;
        };
        Update: {
          analyzed_at?: string;
          company_id?: string;
          label?: string;
          model?: string;
          post_id?: string;
          reason?: string | null;
          score?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'board_sentiment_company_id_post_id_fkey';
            columns: ['company_id', 'post_id'];
            isOneToOne: true;
            referencedRelation: 'naver_board_posts';
            referencedColumns: ['company_id', 'post_id'];
          },
        ];
      };
      chat_audit_log: {
        Row: {
          created_at: string;
          error_msg: string | null;
          id: number;
          input_json: Json;
          is_error: boolean;
          row_count: number | null;
          tool_name: string;
          user_id: string;
          user_role: string;
        };
        Insert: {
          created_at?: string;
          error_msg?: string | null;
          id?: number;
          input_json: Json;
          is_error?: boolean;
          row_count?: number | null;
          tool_name: string;
          user_id: string;
          user_role: string;
        };
        Update: {
          created_at?: string;
          error_msg?: string | null;
          id?: number;
          input_json?: Json;
          is_error?: boolean;
          row_count?: number | null;
          tool_name?: string;
          user_id?: string;
          user_role?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          business_summary: string | null;
          company_type: string | null;
          country: string;
          created_at: string;
          currency: string;
          customers: Json;
          customers_updated_at: string | null;
          dart_collection_status: string | null;
          dart_corp_code: string | null;
          data_source: string;
          fiscal_year_end_month: number;
          group_name: string | null;
          homepage_url: string | null;
          id: string;
          is_seed: boolean;
          last_change_pct: number | null;
          last_collect_error: string | null;
          last_price: number | null;
          last_updated_at: string | null;
          last_volume: number | null;
          market: string | null;
          market_cap: number | null;
          merged_into_company_id: string | null;
          name: string;
          name_kr: string;
          products: Json;
          region: string | null;
          retry_after: string | null;
          status: string;
          summary_updated_at: string | null;
          ticker: string | null;
          updated_at: string;
        };
        Insert: {
          business_summary?: string | null;
          company_type?: string | null;
          country: string;
          created_at?: string;
          currency: string;
          customers?: Json;
          customers_updated_at?: string | null;
          dart_collection_status?: string | null;
          dart_corp_code?: string | null;
          data_source: string;
          fiscal_year_end_month?: number;
          group_name?: string | null;
          homepage_url?: string | null;
          id?: string;
          is_seed?: boolean;
          last_change_pct?: number | null;
          last_collect_error?: string | null;
          last_price?: number | null;
          last_updated_at?: string | null;
          last_volume?: number | null;
          market?: string | null;
          market_cap?: number | null;
          merged_into_company_id?: string | null;
          name: string;
          name_kr: string;
          products?: Json;
          region?: string | null;
          retry_after?: string | null;
          status?: string;
          summary_updated_at?: string | null;
          ticker?: string | null;
          updated_at?: string;
        };
        Update: {
          business_summary?: string | null;
          company_type?: string | null;
          country?: string;
          created_at?: string;
          currency?: string;
          customers?: Json;
          customers_updated_at?: string | null;
          dart_collection_status?: string | null;
          dart_corp_code?: string | null;
          data_source?: string;
          fiscal_year_end_month?: number;
          group_name?: string | null;
          homepage_url?: string | null;
          id?: string;
          is_seed?: boolean;
          last_change_pct?: number | null;
          last_collect_error?: string | null;
          last_price?: number | null;
          last_updated_at?: string | null;
          last_volume?: number | null;
          market?: string | null;
          market_cap?: number | null;
          merged_into_company_id?: string | null;
          name?: string;
          name_kr?: string;
          products?: Json;
          region?: string | null;
          retry_after?: string | null;
          status?: string;
          summary_updated_at?: string | null;
          ticker?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'companies_merged_into_company_id_fkey';
            columns: ['merged_into_company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'companies_merged_into_company_id_fkey';
            columns: ['merged_into_company_id'];
            isOneToOne: false;
            referencedRelation: 'domestic_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'companies_merged_into_company_id_fkey';
            columns: ['merged_into_company_id'];
            isOneToOne: false;
            referencedRelation: 'parts_top100_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'companies_merged_into_company_id_fkey';
            columns: ['merged_into_company_id'];
            isOneToOne: false;
            referencedRelation: 'related_stocks_view';
            referencedColumns: ['id'];
          },
        ];
      };
      company_pages: {
        Row: {
          company_id: string;
          created_at: string;
          page: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          page: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          page?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'company_pages_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'company_pages_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'domestic_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'company_pages_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'parts_top100_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'company_pages_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'related_stocks_view';
            referencedColumns: ['id'];
          },
        ];
      };
      cox_brand_inventory: {
        Row: {
          brand: string;
          collected_at: string;
          days_supply: number | null;
          image_url: string | null;
          is_outlier_excluded: boolean;
          source_url: string | null;
          year_month: number;
        };
        Insert: {
          brand: string;
          collected_at?: string;
          days_supply?: number | null;
          image_url?: string | null;
          is_outlier_excluded?: boolean;
          source_url?: string | null;
          year_month: number;
        };
        Update: {
          brand?: string;
          collected_at?: string;
          days_supply?: number | null;
          image_url?: string | null;
          is_outlier_excluded?: boolean;
          source_url?: string | null;
          year_month?: number;
        };
        Relationships: [];
      };
      exchange_rates: {
        Row: {
          base: string;
          quote: string;
          rate: number;
          rate_date: string;
        };
        Insert: {
          base: string;
          quote?: string;
          rate: number;
          rate_date: string;
        };
        Update: {
          base?: string;
          quote?: string;
          rate?: number;
          rate_date?: string;
        };
        Relationships: [];
      };
      exchange_rates_live: {
        Row: {
          base: string;
          quote: string;
          rate: number;
          updated_at: string;
        };
        Insert: {
          base: string;
          quote?: string;
          rate: number;
          updated_at?: string;
        };
        Update: {
          base?: string;
          quote?: string;
          rate?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      finance_entries: {
        Row: {
          account: string;
          consolidation: string;
          period_kind: string;
          period_month: number;
          period_year: number;
          subsidiary: string;
          value_mwon: number | null;
        };
        Insert: {
          account: string;
          consolidation: string;
          period_kind: string;
          period_month: number;
          period_year: number;
          subsidiary: string;
          value_mwon?: number | null;
        };
        Update: {
          account?: string;
          consolidation?: string;
          period_kind?: string;
          period_month?: number;
          period_year?: number;
          subsidiary?: string;
          value_mwon?: number | null;
        };
        Relationships: [];
      };
      financials: {
        Row: {
          bps: number | null;
          cfps: number | null;
          cogs: number | null;
          company_id: string;
          consolidation: string | null;
          currency: string;
          current_ratio: number | null;
          debt_ratio: number | null;
          dividend_yield: number | null;
          dps: number | null;
          ebitda: number | null;
          eps: number | null;
          ev_ebit: number | null;
          ev_ebitda: number | null;
          fiscal_quarter: number | null;
          fiscal_year: number;
          gross_margin: number | null;
          gross_profit: number | null;
          id: string;
          inventory: number | null;
          labor_cost: number | null;
          net_income: number | null;
          net_margin: number | null;
          operating_income: number | null;
          operating_margin: number | null;
          pbr: number | null;
          per: number | null;
          period_end_date: string | null;
          period_type: string;
          psr: number | null;
          revenue: number | null;
          roa: number | null;
          roe: number | null;
          sga: number | null;
          source: string | null;
          total_assets: number | null;
          total_equity: number | null;
          total_liabilities: number | null;
        };
        Insert: {
          bps?: number | null;
          cfps?: number | null;
          cogs?: number | null;
          company_id: string;
          consolidation?: string | null;
          currency: string;
          current_ratio?: number | null;
          debt_ratio?: number | null;
          dividend_yield?: number | null;
          dps?: number | null;
          ebitda?: number | null;
          eps?: number | null;
          ev_ebit?: number | null;
          ev_ebitda?: number | null;
          fiscal_quarter?: number | null;
          fiscal_year: number;
          gross_margin?: number | null;
          gross_profit?: number | null;
          id?: string;
          inventory?: number | null;
          labor_cost?: number | null;
          net_income?: number | null;
          net_margin?: number | null;
          operating_income?: number | null;
          operating_margin?: number | null;
          pbr?: number | null;
          per?: number | null;
          period_end_date?: string | null;
          period_type: string;
          psr?: number | null;
          revenue?: number | null;
          roa?: number | null;
          roe?: number | null;
          sga?: number | null;
          source?: string | null;
          total_assets?: number | null;
          total_equity?: number | null;
          total_liabilities?: number | null;
        };
        Update: {
          bps?: number | null;
          cfps?: number | null;
          cogs?: number | null;
          company_id?: string;
          consolidation?: string | null;
          currency?: string;
          current_ratio?: number | null;
          debt_ratio?: number | null;
          dividend_yield?: number | null;
          dps?: number | null;
          ebitda?: number | null;
          eps?: number | null;
          ev_ebit?: number | null;
          ev_ebitda?: number | null;
          fiscal_quarter?: number | null;
          fiscal_year?: number;
          gross_margin?: number | null;
          gross_profit?: number | null;
          id?: string;
          inventory?: number | null;
          labor_cost?: number | null;
          net_income?: number | null;
          net_margin?: number | null;
          operating_income?: number | null;
          operating_margin?: number | null;
          pbr?: number | null;
          per?: number | null;
          period_end_date?: string | null;
          period_type?: string;
          psr?: number | null;
          revenue?: number | null;
          roa?: number | null;
          roe?: number | null;
          sga?: number | null;
          source?: string | null;
          total_assets?: number | null;
          total_equity?: number | null;
          total_liabilities?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'financials_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'financials_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'domestic_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'financials_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'parts_top100_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'financials_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'related_stocks_view';
            referencedColumns: ['id'];
          },
        ];
      };
      hyundai_export_regions: {
        Row: {
          collected_at: string;
          period_type: string;
          region_name: string;
          sales_units: number;
          source: string;
          source_url: string | null;
          year_period: string;
        };
        Insert: {
          collected_at?: string;
          period_type?: string;
          region_name?: string;
          sales_units: number;
          source: string;
          source_url?: string | null;
          year_period?: string;
        };
        Update: {
          collected_at?: string;
          period_type?: string;
          region_name?: string;
          sales_units?: number;
          source?: string;
          source_url?: string | null;
          year_period?: string;
        };
        Relationships: [];
      };
      hyundai_quarterly_earnings: {
        Row: {
          cogs_krw_bn: number | null;
          collected_at: string;
          domestic_retail_k_units: number | null;
          domestic_wholesale_k_units: number | null;
          ebitda_krw_bn: number | null;
          eco_total_k_units: number | null;
          ev_k_units: number | null;
          fcev_k_units: number | null;
          fiscal_quarter: number;
          fiscal_year: number;
          global_retail_k_units: number | null;
          global_wholesale_k_units: number | null;
          gross_margin_pct: number | null;
          gross_profit_krw_bn: number | null;
          hev_k_units: number | null;
          last_processed_at: string | null;
          net_income_controlling_krw_bn: number | null;
          net_income_krw_bn: number | null;
          operating_income_krw_bn: number | null;
          operating_margin_pct: number | null;
          overseas_wholesale_k_units: number | null;
          pdf_etag: string | null;
          pdf_sha256: string | null;
          pdf_url: string;
          period_end_date: string | null;
          phev_k_units: number | null;
          pretax_income_krw_bn: number | null;
          revenue_auto_krw_bn: number | null;
          revenue_finance_krw_bn: number | null;
          revenue_krw_bn: number | null;
          revenue_other_krw_bn: number | null;
          sga_krw_bn: number | null;
          source_url: string | null;
        };
        Insert: {
          cogs_krw_bn?: number | null;
          collected_at?: string;
          domestic_retail_k_units?: number | null;
          domestic_wholesale_k_units?: number | null;
          ebitda_krw_bn?: number | null;
          eco_total_k_units?: number | null;
          ev_k_units?: number | null;
          fcev_k_units?: number | null;
          fiscal_quarter: number;
          fiscal_year: number;
          global_retail_k_units?: number | null;
          global_wholesale_k_units?: number | null;
          gross_margin_pct?: number | null;
          gross_profit_krw_bn?: number | null;
          hev_k_units?: number | null;
          last_processed_at?: string | null;
          net_income_controlling_krw_bn?: number | null;
          net_income_krw_bn?: number | null;
          operating_income_krw_bn?: number | null;
          operating_margin_pct?: number | null;
          overseas_wholesale_k_units?: number | null;
          pdf_etag?: string | null;
          pdf_sha256?: string | null;
          pdf_url: string;
          period_end_date?: string | null;
          phev_k_units?: number | null;
          pretax_income_krw_bn?: number | null;
          revenue_auto_krw_bn?: number | null;
          revenue_finance_krw_bn?: number | null;
          revenue_krw_bn?: number | null;
          revenue_other_krw_bn?: number | null;
          sga_krw_bn?: number | null;
          source_url?: string | null;
        };
        Update: {
          cogs_krw_bn?: number | null;
          collected_at?: string;
          domestic_retail_k_units?: number | null;
          domestic_wholesale_k_units?: number | null;
          ebitda_krw_bn?: number | null;
          eco_total_k_units?: number | null;
          ev_k_units?: number | null;
          fcev_k_units?: number | null;
          fiscal_quarter?: number;
          fiscal_year?: number;
          global_retail_k_units?: number | null;
          global_wholesale_k_units?: number | null;
          gross_margin_pct?: number | null;
          gross_profit_krw_bn?: number | null;
          hev_k_units?: number | null;
          last_processed_at?: string | null;
          net_income_controlling_krw_bn?: number | null;
          net_income_krw_bn?: number | null;
          operating_income_krw_bn?: number | null;
          operating_margin_pct?: number | null;
          overseas_wholesale_k_units?: number | null;
          pdf_etag?: string | null;
          pdf_sha256?: string | null;
          pdf_url?: string;
          period_end_date?: string | null;
          phev_k_units?: number | null;
          pretax_income_krw_bn?: number | null;
          revenue_auto_krw_bn?: number | null;
          revenue_finance_krw_bn?: number | null;
          revenue_krw_bn?: number | null;
          revenue_other_krw_bn?: number | null;
          sga_krw_bn?: number | null;
          source_url?: string | null;
        };
        Relationships: [];
      };
      hyundai_retail_sales: {
        Row: {
          collected_at: string;
          industry_total: number | null;
          market_share: number | null;
          period_type: string;
          region: string;
          retail_units: number | null;
          source_type: string;
          source_url: string | null;
          vehicle_model: string;
          vehicle_type: string;
          year_period: string;
        };
        Insert: {
          collected_at?: string;
          industry_total?: number | null;
          market_share?: number | null;
          period_type?: string;
          region?: string;
          retail_units?: number | null;
          source_type?: string;
          source_url?: string | null;
          vehicle_model?: string;
          vehicle_type?: string;
          year_period?: string;
        };
        Update: {
          collected_at?: string;
          industry_total?: number | null;
          market_share?: number | null;
          period_type?: string;
          region?: string;
          retail_units?: number | null;
          source_type?: string;
          source_url?: string | null;
          vehicle_model?: string;
          vehicle_type?: string;
          year_period?: string;
        };
        Relationships: [];
      };
      hyundai_sales: {
        Row: {
          collected_at: string;
          factory: string;
          period_type: string;
          powertrain: string | null;
          region: string;
          sales_units: number;
          source_url: string | null;
          vehicle_model: string;
          vehicle_type: string;
          year_period: string;
        };
        Insert: {
          collected_at?: string;
          factory?: string;
          period_type?: string;
          powertrain?: string | null;
          region?: string;
          sales_units: number;
          source_url?: string | null;
          vehicle_model?: string;
          vehicle_type?: string;
          year_period?: string;
        };
        Update: {
          collected_at?: string;
          factory?: string;
          period_type?: string;
          powertrain?: string | null;
          region?: string;
          sales_units?: number;
          source_url?: string | null;
          vehicle_model?: string;
          vehicle_type?: string;
          year_period?: string;
        };
        Relationships: [];
      };
      inventory_entries: {
        Row: {
          category: string;
          fx_rate: number | null;
          item: string;
          kind: string;
          period_month: number;
          period_year: number;
          unit: string | null;
          value: number | null;
        };
        Insert: {
          category: string;
          fx_rate?: number | null;
          item: string;
          kind: string;
          period_month: number;
          period_year: number;
          unit?: string | null;
          value?: number | null;
        };
        Update: {
          category?: string;
          fx_rate?: number | null;
          item?: string;
          kind?: string;
          period_month?: number;
          period_year?: number;
          unit?: string | null;
          value?: number | null;
        };
        Relationships: [];
      };
      kg_mobility_sales: {
        Row: {
          collected_at: string;
          period_type: string;
          powertrain: string | null;
          region: string;
          sales_units: number;
          source_url: string | null;
          vehicle_model: string;
          vehicle_type: string;
          year_period: string;
        };
        Insert: {
          collected_at?: string;
          period_type?: string;
          powertrain?: string | null;
          region?: string;
          sales_units: number;
          source_url?: string | null;
          vehicle_model?: string;
          vehicle_type?: string;
          year_period?: string;
        };
        Update: {
          collected_at?: string;
          period_type?: string;
          powertrain?: string | null;
          region?: string;
          sales_units?: number;
          source_url?: string | null;
          vehicle_model?: string;
          vehicle_type?: string;
          year_period?: string;
        };
        Relationships: [];
      };
      kia_export_regions: {
        Row: {
          collected_at: string;
          period_type: string;
          region_name: string;
          sales_units: number;
          source: string;
          source_url: string | null;
          vehicle_type: string;
          year_period: string;
        };
        Insert: {
          collected_at?: string;
          period_type?: string;
          region_name?: string;
          sales_units?: number;
          source?: string;
          source_url?: string | null;
          vehicle_type?: string;
          year_period?: string;
        };
        Update: {
          collected_at?: string;
          period_type?: string;
          region_name?: string;
          sales_units?: number;
          source?: string;
          source_url?: string | null;
          vehicle_type?: string;
          year_period?: string;
        };
        Relationships: [];
      };
      kia_retail_sales: {
        Row: {
          collected_at: string;
          period_type: string;
          plant: string;
          region: string;
          retail_units: number;
          source_url: string | null;
          vehicle_model: string;
          year_period: string;
        };
        Insert: {
          collected_at?: string;
          period_type?: string;
          plant?: string;
          region?: string;
          retail_units?: number;
          source_url?: string | null;
          vehicle_model?: string;
          year_period?: string;
        };
        Update: {
          collected_at?: string;
          period_type?: string;
          plant?: string;
          region?: string;
          retail_units?: number;
          source_url?: string | null;
          vehicle_model?: string;
          year_period?: string;
        };
        Relationships: [];
      };
      kia_sales: {
        Row: {
          collected_at: string;
          factory: string;
          period_type: string;
          region: string;
          sales_units: number;
          source_url: string | null;
          vehicle_model: string;
          vehicle_type: string | null;
          year_period: string;
        };
        Insert: {
          collected_at?: string;
          factory?: string;
          period_type?: string;
          region?: string;
          sales_units?: number;
          source_url?: string | null;
          vehicle_model?: string;
          vehicle_type?: string | null;
          year_period?: string;
        };
        Update: {
          collected_at?: string;
          factory?: string;
          period_type?: string;
          region?: string;
          sales_units?: number;
          source_url?: string | null;
          vehicle_model?: string;
          vehicle_type?: string | null;
          year_period?: string;
        };
        Relationships: [];
      };
      kis_tokens: {
        Row: {
          env_key: string;
          expires_at: string;
          token: string;
          updated_at: string;
        };
        Insert: {
          env_key: string;
          expires_at: string;
          token: string;
          updated_at?: string;
        };
        Update: {
          env_key?: string;
          expires_at?: string;
          token?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      loan_entries: {
        Row: {
          kind: string;
          loan_eok: number | null;
          period_month: number;
          period_year: number;
        };
        Insert: {
          kind: string;
          loan_eok?: number | null;
          period_month: number;
          period_year: number;
        };
        Update: {
          kind?: string;
          loan_eok?: number | null;
          period_month?: number;
          period_year?: number;
        };
        Relationships: [];
      };
      longterm_revenue_plan: {
        Row: {
          basis_quarter: number;
          basis_year: number;
          fx_note: string | null;
          period_year: number;
          series: string;
          value_mwon: number | null;
        };
        Insert: {
          basis_quarter: number;
          basis_year: number;
          fx_note?: string | null;
          period_year: number;
          series: string;
          value_mwon?: number | null;
        };
        Update: {
          basis_quarter?: number;
          basis_year?: number;
          fx_note?: string | null;
          period_year?: number;
          series?: string;
          value_mwon?: number | null;
        };
        Relationships: [];
      };
      macro_outlook_notes: {
        Row: {
          created_at: string;
          id: string;
          note_date: string;
          sentiment: string | null;
          source: string;
          summary: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          note_date: string;
          sentiment?: string | null;
          source: string;
          summary: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          note_date?: string;
          sentiment?: string | null;
          source?: string;
          summary?: string;
        };
        Relationships: [];
      };
      management_uploads: {
        Row: {
          created_at: string;
          error_msg: string | null;
          excel_path: string;
          file_name: string;
          id: string;
          mode: string | null;
          status: string;
          summary: Json | null;
          updated_at: string;
          uploaded_by: string | null;
        };
        Insert: {
          created_at?: string;
          error_msg?: string | null;
          excel_path: string;
          file_name: string;
          id?: string;
          mode?: string | null;
          status?: string;
          summary?: Json | null;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Update: {
          created_at?: string;
          error_msg?: string | null;
          excel_path?: string;
          file_name?: string;
          id?: string;
          mode?: string | null;
          status?: string;
          summary?: Json | null;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Relationships: [];
      };
      market_series: {
        Row: {
          category: string;
          fred_symbol: string | null;
          label: string;
          series_code: string;
          sort_order: number;
          source: string;
          unit: string;
          yf_symbol: string | null;
        };
        Insert: {
          category: string;
          fred_symbol?: string | null;
          label: string;
          series_code: string;
          sort_order?: number;
          source: string;
          unit: string;
          yf_symbol?: string | null;
        };
        Update: {
          category?: string;
          fred_symbol?: string | null;
          label?: string;
          series_code?: string;
          sort_order?: number;
          source?: string;
          unit?: string;
          yf_symbol?: string | null;
        };
        Relationships: [];
      };
      market_series_daily: {
        Row: {
          close: number;
          series_code: string;
          trade_date: string;
        };
        Insert: {
          close: number;
          series_code: string;
          trade_date: string;
        };
        Update: {
          close?: number;
          series_code?: string;
          trade_date?: string;
        };
        Relationships: [];
      };
      market_series_live: {
        Row: {
          price: number;
          series_code: string;
          updated_at: string;
        };
        Insert: {
          price: number;
          series_code: string;
          updated_at: string;
        };
        Update: {
          price?: number;
          series_code?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'market_series_live_series_code_fkey';
            columns: ['series_code'];
            isOneToOne: true;
            referencedRelation: 'market_series';
            referencedColumns: ['series_code'];
          },
        ];
      };
      naver_board_posts: {
        Row: {
          body: string | null;
          company_id: string;
          dislikes: number | null;
          fetched_at: string;
          likes: number | null;
          post_id: string;
          posted_at: string;
          title: string;
          views: number | null;
        };
        Insert: {
          body?: string | null;
          company_id: string;
          dislikes?: number | null;
          fetched_at?: string;
          likes?: number | null;
          post_id: string;
          posted_at: string;
          title: string;
          views?: number | null;
        };
        Update: {
          body?: string | null;
          company_id?: string;
          dislikes?: number | null;
          fetched_at?: string;
          likes?: number | null;
          post_id?: string;
          posted_at?: string;
          title?: string;
          views?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'naver_board_posts_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'naver_board_posts_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'domestic_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'naver_board_posts_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'parts_top100_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'naver_board_posts_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'related_stocks_view';
            referencedColumns: ['id'];
          },
        ];
      };
      news: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          published_at: string;
          source: string | null;
          summary: string | null;
          title: string;
          url: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          published_at: string;
          source?: string | null;
          summary?: string | null;
          title: string;
          url: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          published_at?: string;
          source?: string | null;
          summary?: string | null;
          title?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'news_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'news_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'domestic_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'news_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'parts_top100_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'news_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'related_stocks_view';
            referencedColumns: ['id'];
          },
        ];
      };
      oem_competitor_set: {
        Row: {
          competitor_models: string[];
          countries: string[] | null;
          display_order: number;
          market: string;
          market_label: string;
          model_key: string;
          segment_note: string | null;
          target_models: string[];
        };
        Insert: {
          competitor_models: string[];
          countries?: string[] | null;
          display_order: number;
          market: string;
          market_label: string;
          model_key: string;
          segment_note?: string | null;
          target_models: string[];
        };
        Update: {
          competitor_models?: string[];
          countries?: string[] | null;
          display_order?: number;
          market?: string;
          market_label?: string;
          model_key?: string;
          segment_note?: string | null;
          target_models?: string[];
        };
        Relationships: [];
      };
      oem_model_brand: {
        Row: {
          cox_brand: string | null;
          display_brand: string;
          model: string;
        };
        Insert: {
          cox_brand?: string | null;
          display_brand: string;
          model: string;
        };
        Update: {
          cox_brand?: string | null;
          display_brand?: string;
          model?: string;
        };
        Relationships: [];
      };
      oem_model_outlook: {
        Row: {
          competitive_view: string | null;
          consumer_view: string;
          label: string;
          market_breakdown: Json | null;
          metrics: Json | null;
          model_cycle: Json | null;
          model_key: string;
          model_name: string;
          note_date: string;
          oem_group: string;
          outlook: string;
          rationale: string;
          region: string;
          sales_trend: string | null;
          sources: Json | null;
          sources_used: string | null;
        };
        Insert: {
          competitive_view?: string | null;
          consumer_view: string;
          label: string;
          market_breakdown?: Json | null;
          metrics?: Json | null;
          model_cycle?: Json | null;
          model_key: string;
          model_name: string;
          note_date: string;
          oem_group: string;
          outlook: string;
          rationale: string;
          region?: string;
          sales_trend?: string | null;
          sources?: Json | null;
          sources_used?: string | null;
        };
        Update: {
          competitive_view?: string | null;
          consumer_view?: string;
          label?: string;
          market_breakdown?: Json | null;
          metrics?: Json | null;
          model_cycle?: Json | null;
          model_key?: string;
          model_name?: string;
          note_date?: string;
          oem_group?: string;
          outlook?: string;
          rationale?: string;
          region?: string;
          sales_trend?: string | null;
          sources?: Json | null;
          sources_used?: string | null;
        };
        Relationships: [];
      };
      oem_model_segment: {
        Row: {
          country: string;
          model: string;
          powertrains: string[];
          segment: string;
          vehicle_type: string;
        };
        Insert: {
          country: string;
          model: string;
          powertrains?: string[];
          segment: string;
          vehicle_type: string;
        };
        Update: {
          country?: string;
          model?: string;
          powertrains?: string[];
          segment?: string;
          vehicle_type?: string;
        };
        Relationships: [];
      };
      oem_production_model_country_month: {
        Row: {
          country: string;
          model: string;
          oem_group: string;
          production: number;
          year_month: number;
        };
        Insert: {
          country?: string;
          model?: string;
          oem_group?: string;
          production: number;
          year_month: number;
        };
        Update: {
          country?: string;
          model?: string;
          oem_group?: string;
          production?: number;
          year_month?: number;
        };
        Relationships: [];
      };
      oem_sales_group_country_month: {
        Row: {
          country: string;
          oem_group: string;
          sales: number;
          year_month: number;
        };
        Insert: {
          country: string;
          oem_group: string;
          sales: number;
          year_month: number;
        };
        Update: {
          country?: string;
          oem_group?: string;
          sales?: number;
          year_month?: number;
        };
        Relationships: [];
      };
      oem_sales_group_month: {
        Row: {
          oem_group: string;
          sales: number;
          year_month: number;
        };
        Insert: {
          oem_group: string;
          sales: number;
          year_month: number;
        };
        Update: {
          oem_group?: string;
          sales?: number;
          year_month?: number;
        };
        Relationships: [];
      };
      oem_sales_group_pt_month: {
        Row: {
          oem_group: string;
          powertrain: string;
          sales: number;
          year_month: number;
        };
        Insert: {
          oem_group: string;
          powertrain: string;
          sales: number;
          year_month: number;
        };
        Update: {
          oem_group?: string;
          powertrain?: string;
          sales?: number;
          year_month?: number;
        };
        Relationships: [];
      };
      oem_sales_model_country_month: {
        Row: {
          country: string;
          model: string;
          oem_group: string;
          sales: number;
          year_month: number;
        };
        Insert: {
          country?: string;
          model?: string;
          oem_group?: string;
          sales: number;
          year_month: number;
        };
        Update: {
          country?: string;
          model?: string;
          oem_group?: string;
          sales?: number;
          year_month?: number;
        };
        Relationships: [];
      };
      oem_sales_type_seg_month: {
        Row: {
          sales: number;
          segment: string;
          vehicle_type: string;
          year_month: number;
        };
        Insert: {
          sales: number;
          segment: string;
          vehicle_type: string;
          year_month: number;
        };
        Update: {
          sales?: number;
          segment?: string;
          vehicle_type?: string;
          year_month?: number;
        };
        Relationships: [];
      };
      org_charts: {
        Row: {
          chart_date: string;
          created_at: string;
          height: number | null;
          image_path: string;
          source_file: string | null;
          title: string | null;
          width: number | null;
        };
        Insert: {
          chart_date: string;
          created_at?: string;
          height?: number | null;
          image_path: string;
          source_file?: string | null;
          title?: string | null;
          width?: number | null;
        };
        Update: {
          chart_date?: string;
          created_at?: string;
          height?: number | null;
          image_path?: string;
          source_file?: string | null;
          title?: string | null;
          width?: number | null;
        };
        Relationships: [];
      };
      personnel_entries: {
        Row: {
          detail: string;
          headcount: number | null;
          kind: string;
          period_date: string;
          region: string;
        };
        Insert: {
          detail?: string;
          headcount?: number | null;
          kind: string;
          period_date: string;
          region: string;
        };
        Update: {
          detail?: string;
          headcount?: number | null;
          kind?: string;
          period_date?: string;
          region?: string;
        };
        Relationships: [];
      };
      pnl_cost_structure: {
        Row: {
          account: string;
          category: string;
          kind: string;
          period_kind: string;
          period_month: number;
          period_year: number;
          value_mwon: number | null;
        };
        Insert: {
          account: string;
          category: string;
          kind: string;
          period_kind: string;
          period_month?: number;
          period_year: number;
          value_mwon?: number | null;
        };
        Update: {
          account?: string;
          category?: string;
          kind?: string;
          period_kind?: string;
          period_month?: number;
          period_year?: number;
          value_mwon?: number | null;
        };
        Relationships: [];
      };
      pnl_entries: {
        Row: {
          basis: string;
          customer: string;
          division: string;
          expense: number | null;
          factory: string;
          is_estimate: boolean;
          is_plan: boolean;
          labor_cost: number | null;
          material_cost: number | null;
          op_income: number | null;
          period_month: number;
          period_year: number;
          product: string;
          revenue: number | null;
          rnd: number | null;
          sga: number | null;
          sil: string;
          year_label: string;
        };
        Insert: {
          basis: string;
          customer?: string;
          division?: string;
          expense?: number | null;
          factory?: string;
          is_estimate?: boolean;
          is_plan?: boolean;
          labor_cost?: number | null;
          material_cost?: number | null;
          op_income?: number | null;
          period_month?: number;
          period_year: number;
          product?: string;
          revenue?: number | null;
          rnd?: number | null;
          sga?: number | null;
          sil?: string;
          year_label: string;
        };
        Update: {
          basis?: string;
          customer?: string;
          division?: string;
          expense?: number | null;
          factory?: string;
          is_estimate?: boolean;
          is_plan?: boolean;
          labor_cost?: number | null;
          material_cost?: number | null;
          op_income?: number | null;
          period_month?: number;
          period_year?: number;
          product?: string;
          revenue?: number | null;
          rnd?: number | null;
          sga?: number | null;
          sil?: string;
          year_label?: string;
        };
        Relationships: [];
      };
      pnl_fixed_variable: {
        Row: {
          account: string;
          category2: string;
          category3: string;
          cost_type: string;
          period_kind: string;
          period_month: number;
          period_year: number;
          value_mwon: number | null;
        };
        Insert: {
          account: string;
          category2: string;
          category3: string;
          cost_type: string;
          period_kind: string;
          period_month?: number;
          period_year: number;
          value_mwon?: number | null;
        };
        Update: {
          account?: string;
          category2?: string;
          category3?: string;
          cost_type?: string;
          period_kind?: string;
          period_month?: number;
          period_year?: number;
          value_mwon?: number | null;
        };
        Relationships: [];
      };
      pnl_plan: {
        Row: {
          basis: string;
          category: string;
          item: string;
          kind: string;
          period_month: number;
          period_type: string;
          period_year: number;
          unit: string;
          value: number | null;
        };
        Insert: {
          basis: string;
          category: string;
          item: string;
          kind: string;
          period_month?: number;
          period_type: string;
          period_year: number;
          unit: string;
          value?: number | null;
        };
        Update: {
          basis?: string;
          category?: string;
          item?: string;
          kind?: string;
          period_month?: number;
          period_type?: string;
          period_year?: number;
          unit?: string;
          value?: number | null;
        };
        Relationships: [];
      };
      posts: {
        Row: {
          category: string | null;
          content: string | null;
          created_at: string;
          error_message: string | null;
          file_name: string | null;
          file_path: string | null;
          html_path: string | null;
          id: number;
          is_confidential: boolean;
          key_scenes: Json | null;
          source_name: string | null;
          source_published_at: string | null;
          source_type: string;
          source_url: string | null;
          status: string;
          thumbnail_url: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          category?: string | null;
          content?: string | null;
          created_at?: string;
          error_message?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          html_path?: string | null;
          id?: number;
          is_confidential?: boolean;
          key_scenes?: Json | null;
          source_name?: string | null;
          source_published_at?: string | null;
          source_type: string;
          source_url?: string | null;
          status?: string;
          thumbnail_url?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          category?: string | null;
          content?: string | null;
          created_at?: string;
          error_message?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          html_path?: string | null;
          id?: number;
          is_confidential?: boolean;
          key_scenes?: Json | null;
          source_name?: string | null;
          source_published_at?: string | null;
          source_type?: string;
          source_url?: string | null;
          status?: string;
          thumbnail_url?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_category_map: {
        Row: {
          normalized: string;
          raw_category: string;
        };
        Insert: {
          normalized: string;
          raw_category: string;
        };
        Update: {
          normalized?: string;
          raw_category?: string;
        };
        Relationships: [];
      };
      stellantis_na_sales: {
        Row: {
          brand: string;
          collected_at: string;
          period_type: string;
          publish_date: string | null;
          region: string;
          release_id: string | null;
          sales_units: number;
          sales_units_prev: number | null;
          source_url: string | null;
          vehicle_model: string;
          year_period: string;
          yoy_pct: number | null;
        };
        Insert: {
          brand?: string;
          collected_at?: string;
          period_type?: string;
          publish_date?: string | null;
          region?: string;
          release_id?: string | null;
          sales_units?: number;
          sales_units_prev?: number | null;
          source_url?: string | null;
          vehicle_model?: string;
          year_period?: string;
          yoy_pct?: number | null;
        };
        Update: {
          brand?: string;
          collected_at?: string;
          period_type?: string;
          publish_date?: string | null;
          region?: string;
          release_id?: string | null;
          sales_units?: number;
          sales_units_prev?: number | null;
          source_url?: string | null;
          vehicle_model?: string;
          year_period?: string;
          yoy_pct?: number | null;
        };
        Relationships: [];
      };
      stellantis_shipments: {
        Row: {
          collected_at: string;
          filing_date: string | null;
          is_derived: boolean;
          period_type: string;
          region: string;
          shipments_units: number;
          source_url: string | null;
          year_period: string;
        };
        Insert: {
          collected_at?: string;
          filing_date?: string | null;
          is_derived?: boolean;
          period_type?: string;
          region: string;
          shipments_units: number;
          source_url?: string | null;
          year_period: string;
        };
        Update: {
          collected_at?: string;
          filing_date?: string | null;
          is_derived?: boolean;
          period_type?: string;
          region?: string;
          shipments_units?: number;
          source_url?: string | null;
          year_period?: string;
        };
        Relationships: [];
      };
      stock_daily_prices: {
        Row: {
          change_pct: number | null;
          close_price: number | null;
          company_id: string;
          high_price: number | null;
          low_price: number | null;
          open_price: number | null;
          trade_date: string;
          volume: number | null;
        };
        Insert: {
          change_pct?: number | null;
          close_price?: number | null;
          company_id: string;
          high_price?: number | null;
          low_price?: number | null;
          open_price?: number | null;
          trade_date: string;
          volume?: number | null;
        };
        Update: {
          change_pct?: number | null;
          close_price?: number | null;
          company_id?: string;
          high_price?: number | null;
          low_price?: number | null;
          open_price?: number | null;
          trade_date?: string;
          volume?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_daily_prices_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_daily_prices_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'domestic_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_daily_prices_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'parts_top100_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_daily_prices_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'related_stocks_view';
            referencedColumns: ['id'];
          },
        ];
      };
      stock_prices: {
        Row: {
          adj_close: number | null;
          close: number;
          company_id: string;
          high: number | null;
          low: number | null;
          open: number | null;
          trade_date: string;
          volume: number | null;
        };
        Insert: {
          adj_close?: number | null;
          close: number;
          company_id: string;
          high?: number | null;
          low?: number | null;
          open?: number | null;
          trade_date: string;
          volume?: number | null;
        };
        Update: {
          adj_close?: number | null;
          close?: number;
          company_id?: string;
          high?: number | null;
          low?: number | null;
          open?: number | null;
          trade_date?: string;
          volume?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_prices_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_prices_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'domestic_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_prices_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'parts_top100_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_prices_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'related_stocks_view';
            referencedColumns: ['id'];
          },
        ];
      };
      stock_quotes_5min: {
        Row: {
          change_pct: number | null;
          company_id: string;
          price: number;
          ts: string;
          volume: number | null;
        };
        Insert: {
          change_pct?: number | null;
          company_id: string;
          price: number;
          ts: string;
          volume?: number | null;
        };
        Update: {
          change_pct?: number | null;
          company_id?: string;
          price?: number;
          ts?: string;
          volume?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_quotes_5min_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_quotes_5min_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'domestic_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_quotes_5min_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'parts_top100_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_quotes_5min_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'related_stocks_view';
            referencedColumns: ['id'];
          },
        ];
      };
      stock_supply_demand: {
        Row: {
          change_pct: number | null;
          close_price: number | null;
          company_id: string;
          foreign_net: number | null;
          individual_net: number | null;
          institution_net: number | null;
          program_net: number | null;
          trade_date: string;
        };
        Insert: {
          change_pct?: number | null;
          close_price?: number | null;
          company_id: string;
          foreign_net?: number | null;
          individual_net?: number | null;
          institution_net?: number | null;
          program_net?: number | null;
          trade_date: string;
        };
        Update: {
          change_pct?: number | null;
          close_price?: number | null;
          company_id?: string;
          foreign_net?: number | null;
          individual_net?: number | null;
          institution_net?: number | null;
          program_net?: number | null;
          trade_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_supply_demand_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_supply_demand_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'domestic_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_supply_demand_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'parts_top100_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_supply_demand_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'related_stocks_view';
            referencedColumns: ['id'];
          },
        ];
      };
      stock_supply_demand_intraday: {
        Row: {
          company_id: string;
          foreign_net: number | null;
          individual_net: number | null;
          institution_net: number | null;
          snapshot_ts: string;
          trade_date: string;
        };
        Insert: {
          company_id: string;
          foreign_net?: number | null;
          individual_net?: number | null;
          institution_net?: number | null;
          snapshot_ts: string;
          trade_date: string;
        };
        Update: {
          company_id?: string;
          foreign_net?: number | null;
          individual_net?: number | null;
          institution_net?: number | null;
          snapshot_ts?: string;
          trade_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_supply_demand_intraday_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'companies';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_supply_demand_intraday_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'domestic_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_supply_demand_intraday_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'parts_top100_stocks_view';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_supply_demand_intraday_company_id_fkey';
            columns: ['company_id'];
            isOneToOne: false;
            referencedRelation: 'related_stocks_view';
            referencedColumns: ['id'];
          },
        ];
      };
      uzauto_pdf_cache: {
        Row: {
          etag: string | null;
          fiscal_year: number;
          last_processed_at: string;
          report_type: string;
          sha256: string | null;
          url: string;
        };
        Insert: {
          etag?: string | null;
          fiscal_year: number;
          last_processed_at?: string;
          report_type: string;
          sha256?: string | null;
          url: string;
        };
        Update: {
          etag?: string | null;
          fiscal_year?: number;
          last_processed_at?: string;
          report_type?: string;
          sha256?: string | null;
          url?: string;
        };
        Relationships: [];
      };
      uzbekistan_auto_stats: {
        Row: {
          brand: string;
          collected_at: string;
          company: string;
          kind: string;
          period_type: string;
          publish_date: string | null;
          source_type: string;
          source_url: string | null;
          units: number;
          vehicle_model: string;
          year_period: string;
        };
        Insert: {
          brand?: string;
          collected_at?: string;
          company?: string;
          kind?: string;
          period_type?: string;
          publish_date?: string | null;
          source_type: string;
          source_url?: string | null;
          units?: number;
          vehicle_model?: string;
          year_period?: string;
        };
        Update: {
          brand?: string;
          collected_at?: string;
          company?: string;
          kind?: string;
          period_type?: string;
          publish_date?: string | null;
          source_type?: string;
          source_url?: string | null;
          units?: number;
          vehicle_model?: string;
          year_period?: string;
        };
        Relationships: [];
      };
      vehicle_powertrain_map: {
        Row: {
          company_slug: string;
          created_at: string;
          powertrain: string;
          source_note: string | null;
          valid_from: string;
          valid_to: string | null;
          vehicle_model: string;
        };
        Insert: {
          company_slug: string;
          created_at?: string;
          powertrain: string;
          source_note?: string | null;
          valid_from?: string;
          valid_to?: string | null;
          vehicle_model: string;
        };
        Update: {
          company_slug?: string;
          created_at?: string;
          powertrain?: string;
          source_note?: string | null;
          valid_from?: string;
          valid_to?: string | null;
          vehicle_model?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      domestic_stocks_view: {
        Row: {
          business_summary: string | null;
          company_type: string | null;
          country: string | null;
          currency: string | null;
          customers: Json | null;
          financials_by_year: Json | null;
          fx_fin_to_krw: number | null;
          fx_to_krw: number | null;
          group_name: string | null;
          homepage_url: string | null;
          id: string | null;
          last_change_pct: number | null;
          last_price: number | null;
          last_updated_at: string | null;
          latest_quarter: Json | null;
          latest_revenue_krw: number | null;
          market: string | null;
          market_cap: number | null;
          name: string | null;
          name_kr: string | null;
          products: Json | null;
          sales_rank: number | null;
          status: string | null;
          summary_updated_at: string | null;
          ticker: string | null;
        };
        Relationships: [];
      };
      oem_competition_monthly_view: {
        Row: {
          display_order: number | null;
          is_target: boolean | null;
          market: string | null;
          market_label: string | null;
          model: string | null;
          model_key: string | null;
          sales: number | null;
          year_month: number | null;
        };
        Relationships: [];
      };
      oem_sales_country_group_year: {
        Row: {
          country: string | null;
          oem_group: string | null;
          sales: number | null;
          year: number | null;
        };
        Relationships: [];
      };
      oem_sales_usa_group_month: {
        Row: {
          oem_group: string | null;
          sales: number | null;
          year_month: number | null;
        };
        Relationships: [];
      };
      humanoid_stocks_view: {
        Row: {
          company_type: string | null;
          country: string | null;
          currency: string | null;
          customers: Json | null;
          financials_by_year: Json | null;
          funding_total_usd: number | null;
          fx_fin_to_krw: number | null;
          fx_to_krw: number | null;
          group_name: string | null;
          homepage_url: string | null;
          id: string | null;
          last_change_pct: number | null;
          last_price: number | null;
          last_updated_at: string | null;
          latest_quarter: Json | null;
          latest_revenue_krw: number | null;
          market: string | null;
          market_cap: number | null;
          name: string | null;
          name_kr: string | null;
          products: Json | null;
          robot_roles: string[] | null;
          sales_rank: number | null;
          status: string | null;
          ticker: string | null;
          valuation_asof: string | null;
          valuation_usd: number | null;
        };
        Relationships: [];
      };
      parts_top100_stocks_view: {
        Row: {
          business_summary: string | null;
          country: string | null;
          currency: string | null;
          customers: Json | null;
          financials_by_year: Json | null;
          fx_fin_to_krw: number | null;
          fx_to_krw: number | null;
          group_name: string | null;
          homepage_url: string | null;
          id: string | null;
          last_change_pct: number | null;
          last_price: number | null;
          last_updated_at: string | null;
          latest_quarter: Json | null;
          latest_revenue_krw: number | null;
          market: string | null;
          market_cap: number | null;
          name: string | null;
          name_kr: string | null;
          products: Json | null;
          sales_rank: number | null;
          status: string | null;
          summary_updated_at: string | null;
          ticker: string | null;
        };
        Relationships: [];
      };
      related_stocks_view: {
        Row: {
          business_summary: string | null;
          company_type: string | null;
          country: string | null;
          currency: string | null;
          customers: Json | null;
          financials_by_year: Json | null;
          fx_fin_to_krw: number | null;
          fx_to_krw: number | null;
          homepage_url: string | null;
          id: string | null;
          last_change_pct: number | null;
          last_price: number | null;
          last_updated_at: string | null;
          latest_quarter: Json | null;
          market: string | null;
          market_cap: number | null;
          name: string | null;
          name_kr: string | null;
          products: Json | null;
          region: string | null;
          status: string | null;
          summary_updated_at: string | null;
          ticker: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      clean_company_legal_form: { Args: { raw: string }; Returns: string };
      expand_customer_name: { Args: { raw: string }; Returns: string[] };
      merge_company: {
        Args: { p_new_id: string; p_old_id: string };
        Returns: undefined;
      };
      normalize_customer_name: { Args: { raw: string }; Returns: string };
      normalize_product_category: { Args: { raw: string }; Returns: string };
      refresh_oem_agg_views: { Args: never; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;

/** 타입 헬퍼: View Row 빠른 추출 */
export type ViewRow<T extends keyof Database['public']['Views']> =
  Database['public']['Views'][T]['Row'];

/** 타입 헬퍼: Table Row 빠른 추출 */
export type TableRow<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
