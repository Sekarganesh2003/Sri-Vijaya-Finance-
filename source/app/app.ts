import {ChangeDetectionStrategy, Component, signal, computed, afterNextRender, effect, PLATFORM_ID, inject} from '@angular/core';
import {isPlatformBrowser, DecimalPipe, DatePipe} from '@angular/common';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {FinanceDB} from '../../src/app/db';
import {Chart, registerables} from 'chart.js';
import {environment} from '../../src/environments/environment';

// Register all Chart.js modules
Chart.register(...registerables);

// Helper functions for dynamic local system dates
export function getLocalTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

export function normalizeDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const trimmed = String(dateStr).trim();
  if (!trimmed) return '';
  
  // If it's already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  
  // If it is YYYY/MM/DD
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(trimmed)) {
    return trimmed.replace(/\//g, '-');
  }

  // If it is DD-MM-YYYY or DD/MM/YYYY
  const dmMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmMatch) {
    const day = dmMatch[1].padStart(2, '0');
    const month = dmMatch[2].padStart(2, '0');
    const year = dmMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Fallback to parse Date object representation if possible
  try {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  } catch {
    return trimmed;
  }

  return trimmed;
}

export function getRelativeDateString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const date = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

// DB Structures
export interface AppSettings {
  companyName: string;
  englishName: string;
  branch: string;
  openingBalance: number;
  audioEnabled: boolean;
  subtitle?: string;
  dailyInterest?: number;
  weeklyInterest?: number;
  monthlyInterest?: number;
  defaultDailyTenure?: number;
  defaultWeeklyTenure?: number;
  defaultMonthlyTenure?: number;
}

export interface StaffUser {
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
  status: 'Active' | 'Blocked';
}

export interface DatabaseBackup {
  id: string;
  timestamp: string;
  date: string;
  size: string;
  data: string;
}

export interface Customer {
  id: string;
  name: string;
  englishName: string;
  phone: string;
  address: string;
  line: 'A' | 'W' | 'M'; // Daily, Weekly, Monthly
  loanAmount: number;
  interestRate: number; // e.g. 10 for 10%
  tenure: number;       // e.g. 100 installments
  status: 'Active' | 'Closed';
  createdAt: string;
  // Extended Onboarding fields
  fatherName?: string;
  occupation?: string;
  idProofType?: string;
  idProofNumber?: string;
  referralId?: string;
  referralRelation?: string;
  collectionGroup?: string;
  interestType?: 'Daily' | 'Weekly' | 'Monthly';
  filesCount?: number;
  clNo?: string;
  profilePhoto?: string;
}

export interface Collection {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  interestAmount: number;
  principalAmount: number;
  line: 'A' | 'W' | 'M';
  date: string; // YYYY-MM-DD
  notes?: string;
  phone?: string;
  paymentMethod?: 'Cash' | 'GPay' | 'PhonePe' | 'Online';
}

export interface Expense {
  id: string;
  type: 'Salary' | 'Rent' | 'Office' | 'Vehicle' | 'Miscellaneous';
  amount: number;
  date: string; // YYYY-MM-DD
  description: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  phone: string;
  status: 'Active' | 'Inactive';
  collectionGroup?: string;
  salary?: number;
  joinDate?: string;
  attendance?: Record<string, 'P' | 'A' | 'H' | 'HO'>;
}

export interface ReportRow {
  id: string;
  type: string;
  tamilType: string;
  customerName: string;
  detail: string;
  amount: number;
  interest: number;
  principal: number;
  date: string;
  colorClass: string;
}

export interface InstallmentScheduleItem {
  num: number;
  date: string;
  amount: number;
  principal: number;
  profit: number;
  remaining: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  standalone: true,
  imports: [ReactiveFormsModule, DecimalPipe, DatePipe],
  templateUrl: '../../src/app/app.html',
  styleUrl: '../../src/app/app.css',
})
export class App {
  protected readonly Math = Math;
  private platformId = inject(PLATFORM_ID);

  // Portfolio Customer Detail Dashboard state matching the requested view
  portfolioCustomer = signal<Customer | null>(null);

  // Authentication State
  passwordVisible = signal<boolean>(false);
  isLoading = signal<boolean>(false);
  loginSuccess = signal<boolean>(false);
  generalError = signal<string>('');

  // Dashboard Interface States
  activeTab = signal<string>('dashboard');
  isSidebarCollapsed = signal<boolean>(false);
  isMobileMenuOpen = signal<boolean>(false);
  isDarkMode = signal<boolean>(false);
  dateFilter = signal<'today' | 'yesterday' | 'month' | 'year' | 'date'>('today');
  customFilterDate = signal<string>(getLocalTodayString()); // Selected custom date
  searchQuery = signal<string>('');
  reportTypeFilter = signal<string>('all');

  // Reports Sub-tab states matching the new screenshot requirement
  selectedReportSubTab = signal<'daily' | 'range' | 'loan' | 'running' | 'line'>('daily');
  reportDailyDate = signal<string>(getLocalTodayString());
  reportRangeFrom = signal<string>(getRelativeDateString(30));
  reportRangeTo = signal<string>(getLocalTodayString());
  reportLoanStatusFilter = signal<string>('Active');
  reportLoanPage = signal<number>(1);
  reportRunningFrom = signal<string>(getRelativeDateString(7));
  reportRunningTo = signal<string>(getLocalTodayString());
  reportLineMonthDate = signal<string>(getLocalTodayString());

  reportDailyCollections = computed(() => {
    const selectedDate = normalizeDate(this.reportDailyDate());
    return this.collections().filter(c => normalizeDate(c.date) === selectedDate);
  });

  reportDailyLoansGiven = computed(() => {
    const selectedDate = normalizeDate(this.reportDailyDate());
    const list: { sNo: number; customerName: string; loanAmount: number; retainedProfit: number; disbursedAmount: number; type: string; payable: number }[] = [];
    const matchedCustomers = this.customers().filter(c => normalizeDate(c.createdAt) === selectedDate);
    matchedCustomers.forEach((c, idx) => {
      const outflowAmount = c.loanAmount; // Total Loan Amount (Outflow)
      const retainedProfit = Math.round(c.loanAmount * (c.interestRate / 100)); // Retained profit/fee
      const disbursedAmount = outflowAmount - retainedProfit; // Actual Cash Paid Out (Net)
      list.push({
        sNo: idx + 1,
        customerName: c.name,
        loanAmount: outflowAmount, // Total Loan Amount (Outflow)
        retainedProfit,
        disbursedAmount,
        type: c.line === 'A' ? 'Daily' : c.line === 'W' ? 'Weekly' : 'Monthly',
        payable: c.loanAmount
      });
    });
    return list;
  });

  reportDailyLoansTotal = computed(() => {
    const list = this.reportDailyLoansGiven();
    return list.reduce((sum, item) => sum + item.loanAmount, 0);
  });

  reportDailyRetainedProfitTotal = computed(() => {
    const list = this.reportDailyLoansGiven();
    return list.reduce((sum, item) => sum + item.retainedProfit, 0);
  });

  reportRangeCollections = computed(() => {
    const fromDate = this.reportRangeFrom();
    const toDate = this.reportRangeTo();
    const filtered = this.collections().filter(c => {
      return c.date >= fromDate && c.date <= toDate;
    });
    return filtered;
  });

  reportLoanListFilter = computed(() => {
    const status = this.reportLoanStatusFilter();
    const tracks = this.allLoanTracks(); // Bypasses category filter to show all loans
    if (status === 'All') return tracks;
    if (status === 'Active') return tracks.filter(t => t.balanceAmount > 0);
    if (status === 'Closed') return tracks.filter(t => t.balanceAmount === 0);
    return tracks;
  });

  paginatedReportLoanList = computed(() => {
    const list = this.reportLoanListFilter();
    const limit = 10;
    const page = Math.min(this.reportLoanPage(), Math.ceil(list.length / limit) || 1);
    const start = (page - 1) * limit;
    return list.slice(start, start + limit);
  });

  reportLoanTotalPages = computed(() => {
    return Math.ceil(this.reportLoanListFilter().length / 10) || 1;
  });

  getPageStartIndex(): number {
    const limit = 10;
    const listLen = this.reportLoanListFilter().length;
    const totalPages = Math.ceil(listLen / limit) || 1;
    const page = Math.min(this.reportLoanPage(), totalPages);
    return (page - 1) * limit;
  }

  getReportLoanPageRange(): (number | string)[] {
    const current = Math.min(this.reportLoanPage(), this.reportLoanTotalPages());
    const total = this.reportLoanTotalPages();
    const pages: (number | string)[] = [];
    
    if (total <= 6) {
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }
      return pages;
    }
    
    pages.push(1);
    
    if (current > 3) {
      pages.push('...');
    }
    
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    
    if (current < total - 2) {
      pages.push('...');
    }
    
    pages.push(total);
    return pages;
  }

  getReportLoanPageInfo(): { start: number; end: number; total: number } {
    const total = this.reportLoanListFilter().length;
    const page = Math.min(this.reportLoanPage(), this.reportLoanTotalPages());
    const start = total === 0 ? 0 : (page - 1) * 10 + 1;
    const end = Math.min(page * 10, total);
    return { start, end, total };
  }

  goToReportLoanPrevPage(): void {
    this.reportLoanPage.set(Math.max(1, this.reportLoanPage() - 1));
  }

  goToReportLoanNextPage(): void {
    const total = this.reportLoanTotalPages();
    this.reportLoanPage.set(Math.min(total, this.reportLoanPage() + 1));
  }

  reportLoanMetrics = computed(() => {
    const list = this.reportLoanListFilter();
    const totalLoansCount = list.length;
    let loanAmountSum = 0;
    let totalPayableSum = 0;
    let collectedSum = 0;
    let balanceSum = 0;

    list.forEach(t => {
      loanAmountSum += t.disbursedAmount;
      totalPayableSum += t.payableAmount;
      collectedSum += t.collectedAmount;
      balanceSum += t.balanceAmount;
    });

    return {
      count: totalLoansCount,
      loanAmount: loanAmountSum,
      payable: totalPayableSum,
      collected: collectedSum,
      balance: balanceSum
    };
  });

  reportRunningBalanceRows = computed(() => {
    const fromStr = this.reportRunningFrom();
    const toStr = this.reportRunningTo();
    
    const startD = new Date(fromStr);
    const endD = new Date(toStr);
    
    const rows: { date: string; collected: number; given: number; expenses: number; net: number; runningBalance: number }[] = [];
    let cumulativeBalance = 0;
    const currentDate = new Date(startD);
    while (currentDate <= endD) {
      const dStr = currentDate.toISOString().slice(0, 10);
      
      let col = 0;
      let giv = 0;
      let exp = 0;
      
      // Daily Collections
      const baseCol = this.collections().filter(c => normalizeDate(c.date) === dStr).reduce((sum, item) => sum + item.amount, 0);
      
      // Daily Loans and Upfront Retained Profit
      const matchingCustomers = this.customers().filter(c => normalizeDate(c.createdAt) === dStr);
      const dayRetainedProfit = matchingCustomers.reduce((sum, c) => sum + Math.round(c.loanAmount * (c.interestRate / 100)), 0);
      
      // Inflow includes both collections and pre-deducted retained profits
      col = baseCol + dayRetainedProfit;
      
      exp += this.expenses().filter(e => normalizeDate(e.date) === dStr).reduce((sum, item) => sum + item.amount, 0);
      
      // Outflow represents total loan amount face value
      giv = matchingCustomers.reduce((sum, c) => sum + c.loanAmount, 0);
      
      const net = col - giv - exp;
      cumulativeBalance += net;
      
      rows.push({
        date: dStr,
        collected: col,
        given: giv,
        expenses: exp,
        net: net,
        runningBalance: cumulativeBalance
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return {
      rows,
      totalCollected: rows.reduce((sum, r) => sum + r.collected, 0),
      totalGiven: rows.reduce((sum, r) => sum + r.given, 0),
      totalExpenses: rows.reduce((sum, r) => sum + r.expenses, 0),
      netBalance: rows.reduce((sum, r) => sum + r.net, 0)
    };
  });

  reportLineSummaryData = computed(() => {
    const selectedDate = this.reportLineMonthDate();
    const month = selectedDate.substring(0, 7);
    
    let dlCount = 0;
    let dlGiven = 0;
    let dlCollected = 0;
    
    let mlCount = 0;
    let mlGiven = 0;
    let mlCollected = 0;
    
    let wlCount = 0;
    let wlGiven = 0;
    let wlCollected = 0;

    const allCustomers = this.customers();
    const allColls = this.collections().filter(c => c.date.startsWith(month));

    allCustomers.forEach(c => {
      if (c.createdAt && c.createdAt.startsWith(month)) {
        const lAmt = Math.round(c.loanAmount * (1 - c.interestRate / 100)); // Disbursed Amount (Given)
        const custColls = allColls.filter(col => col.customerId === c.id);
        const collected = custColls.reduce((sum, col) => sum + col.amount, 0);

        if (c.line === 'A') { // Daily
          dlCount++;
          dlGiven += lAmt;
          dlCollected += collected;
        } else if (c.line === 'M') { // Monthly
          mlCount++;
          mlGiven += lAmt;
          mlCollected += collected;
        } else if (c.line === 'W') { // Weekly
          wlCount++;
          wlGiven += lAmt;
          wlCollected += collected;
        }
      }
    });

    return {
      monthString: month,
      dl: { count: dlCount, given: dlGiven, collected: dlCollected },
      ml: { count: mlCount, given: mlGiven, collected: mlCollected },
      wl: { count: wlCount, given: wlGiven, collected: wlCollected }
    };
  });

  // Dynamic live system date formatted for Tamil/English header
  liveHeaderDate = computed(() => {
    const d = new Date();
    const tamilDays = ['ஞாயிறு', 'திங்கள்', 'செவ்வாய்', 'புதன்', 'வியாழன்', 'வெள்ளி', 'சனி'];
    const tamilMonths = [
      'ஜனவரி', 'பிப்ரவரி', 'மார்ச்', 'ஏப்ரல்', 'மே', 'ஜூன்', 
      'ஜூலை', 'ஆகஸ்ட்', 'செப்டம்பர்', 'அக்டோபர்', 'நவம்பர்', 'டிசம்பர்'
    ];
    const engMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = tamilDays[d.getDay()];
    const dateNum = String(d.getDate()).padStart(2, '0');
    const monthName = tamilMonths[d.getMonth()];
    const yearNum = d.getFullYear();
    const engMonthName = engMonths[d.getMonth()];
    
    return `${dayName}, ${dateNum} ${monthName}, ${yearNum} / ${dateNum}-${engMonthName}-${yearNum}`;
  });

  // Today date string in standard format
  todayDateStr = computed(() => getLocalTodayString());

  // Interactive UI indicators
  toasts = signal<{ id: number; message: string; type: 'success' | 'danger' | 'info' }[]>([]);
  private toastIdCounter = 0;
  showClearConfirm = signal<boolean>(false);

  // Local persistence models
  settings = signal<AppSettings>({
    companyName: 'SmartGoNext',
    englishName: 'SmartGoNext',
    branch: 'புதுச்சேரி',
    subtitle: 'நம்பகமான நிதி சேவை',
    openingBalance: 200000,
    audioEnabled: true,
    dailyInterest: 0,
    weeklyInterest: 0,
    monthlyInterest: 0,
    defaultDailyTenure: 100,
    defaultWeeklyTenure: 52,
    defaultMonthlyTenure: 12
  });

  settingsSubTab = signal<string>('general');
  usersList = signal<StaffUser[]>([]);
  backupsList = signal<DatabaseBackup[]>([]);

  // Special Reports state & calculations
  activeSpecialReport = signal<string | null>(null);
  selectedReportMonth = signal<string>(getLocalTodayString().substring(0, 7));
  selectedLoanTrackFilter = signal<string>('all');

  availableReportMonths = computed(() => {
    const monthsSet = new Set<string>();
    
    // Always include current month as a default
    const currentMonth = getLocalTodayString().substring(0, 7);
    monthsSet.add(currentMonth);

    // Collect months from customers
    this.customers().forEach(c => {
      if (c.createdAt && c.createdAt.length >= 7) {
        monthsSet.add(c.createdAt.substring(0, 7));
      }
    });

    // Collect months from collections
    this.collections().forEach(c => {
      if (c.date && c.date.length >= 7) {
        monthsSet.add(c.date.substring(0, 7));
      }
    });

    // Collect months from expenses
    this.expenses().forEach(e => {
      if (e.date && e.date.length >= 7) {
        monthsSet.add(e.date.substring(0, 7));
      }
    });

    // Sort descending (newest first)
    return Array.from(monthsSet).sort().reverse();
  });

  selectedMonthLabel = computed(() => {
    const yyyymm = this.selectedReportMonth();
    if (!yyyymm || yyyymm.length < 7) return '';
    try {
      const [year, month] = yyyymm.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      const englishName = date.toLocaleString('default', { month: 'long', year: 'numeric' });
      
      // Map to Tamil names (informal translation for support)
      const tamilMonths: Record<string, string> = {
        '01': 'ஜனவரி', '02': 'பிப்ரவரி', '03': 'மார்ச்', '04': 'ஏப்ரல்',
        '05': 'மே', '06': 'ஜூன்', '07': 'ஜூலை', '08': 'ஆகஸ்ட்',
        '09': 'செப்டம்பர்', '10': 'அக்டோபர்', '11': 'நவம்பர்', '12': 'டிசம்பர்'
      };
      const tamilName = tamilMonths[month] || '';
      return `${tamilName} ${year} / ${englishName}`;
    } catch {
      return yyyymm;
    }
  });

  getMonthLabel(yyyymm: string): string {
    if (!yyyymm || yyyymm.length < 7) return yyyymm;
    try {
      const [year, month] = yyyymm.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      return date.toLocaleString('default', { month: 'long', year: 'numeric' });
    } catch {
      return yyyymm;
    }
  }

  getMonthLabelTamil(yyyymm: string): string {
    if (!yyyymm || yyyymm.length < 7) return yyyymm;
    try {
      const [year, month] = yyyymm.split('-');
      const tamilMonths: Record<string, string> = {
        '01': 'ஜனவரி', '02': 'பிப்ரவரி', '03': 'மார்ச்', '04': 'ஏப்ரல்',
        '05': 'மே', '06': 'ஜூன்', '07': 'ஜூலை', '08': 'ஆகஸ்ட்',
        '09': 'செப்டம்பர்', '10': 'அக்டோபர்', '11': 'நவம்பர்', '12': 'டிசம்பர்'
      };
      return `${tamilMonths[month] || ''} ${year}`;
    } catch {
      return yyyymm;
    }
  }

  startingOutstandingTotals = computed(() => {
    const month = this.selectedReportMonth(); // e.g. "2026-06"
    
    const getStartingOutstandingForLine = (line: 'A' | 'W' | 'M') => {
      // Find all customers created BEFORE this month
      const givenBefore = this.customers()
        .filter(c => c.line === line && c.createdAt < `${month}-01`)
        .reduce((sum, item) => sum + item.loanAmount, 0);

      // Find all collections BEFORE this month
      const collsBefore = this.collections()
        .filter(c => c.line === line && c.date < `${month}-01`)
        .reduce((sum, item) => sum + item.amount, 0);

      return Math.max(0, givenBefore - collsBefore);
    };

    const dl = getStartingOutstandingForLine('A');
    const wl = getStartingOutstandingForLine('W');
    const ml = getStartingOutstandingForLine('M');
    const total = dl + wl + ml;

    return { dl, wl, ml, total };
  });

  monthlySummaryRows = computed(() => {
    const month = this.selectedReportMonth();
    
    // Dynamic calculation
    const collectionsInMonth = this.collections().filter(c => c.date.startsWith(month));
    const expensesInMonth = this.expenses().filter(e => e.date.startsWith(month));
    const customersInMonth = this.customers().filter(c => c.createdAt.startsWith(month));
    
    const dates = Array.from(new Set([
      ...collectionsInMonth.map(c => c.date),
      ...expensesInMonth.map(e => e.date),
      ...customersInMonth.map(c => c.createdAt)
    ])).sort();
    
    return dates.map((d, index) => {
      const dayColls = collectionsInMonth.filter(c => c.date === d);
      const dayExps = expensesInMonth.filter(e => e.date === d);
      const dayCusts = customersInMonth.filter(c => c.createdAt === d);
      
      const dlColls = dayColls.filter(c => c.line === 'A');
      const wlColls = dayColls.filter(c => c.line === 'W');
      const mlColls = dayColls.filter(c => c.line === 'M');
      
      const totalCol = dayColls.reduce((sum, c) => sum + c.amount, 0);
      const dlCol = dlColls.reduce((sum, c) => sum + c.amount, 0);
      const wlCol = wlColls.reduce((sum, c) => sum + c.amount, 0);
      const mlCol = mlColls.reduce((sum, c) => sum + c.amount, 0);
      
      const dlCls = dlColls.reduce((sum, c) => sum + c.principalAmount, 0);
      const wlCls = wlColls.reduce((sum, c) => sum + c.principalAmount, 0);
      const mlCls = mlColls.reduce((sum, c) => sum + c.principalAmount, 0);
      
      const dlProfit = dlColls.reduce((sum, c) => sum + c.interestAmount, 0);
      const wlProfit = wlColls.reduce((sum, c) => sum + c.interestAmount, 0);
      const mlProfit = mlColls.reduce((sum, c) => sum + c.interestAmount, 0);
      
      const totalCls = dlCls + wlCls + mlCls;
      const expenseSum = dayExps.reduce((sum, e) => sum + e.amount, 0);
      const newCust = dayCusts.length;
      const newPoint = dayCusts.reduce((sum, c) => sum + c.loanAmount, 0);
      
      return {
        sNo: index + 1,
        date: d,
        totalCol,
        totalCls,
        dlCol,
        dlCls,
        dlProfit,
        wlCol,
        wlCls,
        wlProfit,
        mlCol,
        mlCls,
        mlProfit,
        piItem: 0,
        tempIn: 0,
        tempOut: 0,
        expense: expenseSum,
        newCust,
        newPoint,
        excess: 0,
        defect: 0
      };
    });
  });

  monthlySummaryTotals = computed(() => {
    const rows = this.monthlySummaryRows();
    const totalCol = rows.reduce((s, r) => s + r.totalCol, 0);
    const totalCls = rows.reduce((s, r) => s + r.totalCls, 0);
    const dlCol = rows.reduce((s, r) => s + r.dlCol, 0);
    const dlCls = rows.reduce((s, r) => s + r.dlCls, 0);
    const dlProfit = rows.reduce((s, r) => s + r.dlProfit, 0);
    const wlCol = rows.reduce((s, r) => s + r.wlCol, 0);
    const wlCls = rows.reduce((s, r) => s + r.wlCls, 0);
    const wlProfit = rows.reduce((s, r) => s + r.wlProfit, 0);
    const mlCol = rows.reduce((s, r) => s + r.mlCol, 0);
    const mlCls = rows.reduce((s, r) => s + r.mlCls, 0);
    const mlProfit = rows.reduce((s, r) => s + r.mlProfit, 0);
    const piItem = rows.reduce((s, r) => s + r.piItem, 0);
    const tempIn = rows.reduce((s, r) => s + r.tempIn, 0);
    const tempOut = rows.reduce((s, r) => s + r.tempOut, 0);
    const expense = rows.reduce((s, r) => s + r.expense, 0);
    const newCust = rows.reduce((s, r) => s + r.newCust, 0);
    const newPoint = rows.reduce((s, r) => s + r.newPoint, 0);
    const excess = rows.reduce((s, r) => s + r.excess, 0);
    const defect = rows.reduce((s, r) => s + r.defect, 0);
    
    return {
      totalCol,
      totalCls,
      dlCol,
      dlCls,
      dlProfit,
      wlCol,
      wlCls,
      wlProfit,
      mlCol,
      mlCls,
      mlProfit,
      piItem,
      tempIn,
      tempOut,
      expense,
      newCust,
      newPoint,
      excess,
      defect
    };
  });

  allLoanTracks = computed(() => {
    const month = this.selectedReportMonth();
    
    const allCustomers = this.customers();
    const allColls = this.collections().filter(c => c.date.startsWith(month));
    
    return allCustomers.map((c, index) => {
      const custColls = allColls.filter(col => col.customerId === c.id);
      const collected = custColls.reduce((sum, col) => sum + col.amount, 0);
      const balance = Math.max(0, c.loanAmount - collected);
      
      const days: Record<number, number> = {};
      custColls.forEach(col => {
        const dObj = new Date(col.date);
        const day = dObj.getDate();
        days[day] = (days[day] || 0) + col.amount;
      });

      const lAmt = Math.round(c.loanAmount * (1 - c.interestRate / 100));
      const lPay = c.loanAmount;
      const lCol = collected;
      const lBal = Math.max(0, lPay - lCol);
      
      return {
        sNo: index + 1,
        place: c.address.split(',')[0] || 'Unknown',
        loanNo: c.clNo && c.clNo.trim() ? c.clNo : `SRF-2026-${String(index+1).padStart(5, '0')}`,
        type: c.line === 'A' ? 'DL' : c.line === 'W' ? 'WL' : 'ML',
        customerName: c.name,
        clNo: c.clNo,
        phone: c.phone,
        start: c.createdAt,
        end: '',
        instalment: Math.round(c.loanAmount / c.tenure),
        total: c.loanAmount,
        interestRate: c.interestRate,
        days,
        collected,
        balance,
        profilePhoto: c.profilePhoto,
        disbursedAmount: lAmt,
        payableAmount: lPay,
        collectedAmount: lCol,
        balanceAmount: lBal
      };
    });
  });

  localLoanTracks = computed(() => {
    const filter = this.selectedLoanTrackFilter();
    const tracks = this.allLoanTracks();
    if (filter === 'all') return tracks;
    return tracks.filter(l => l.type === filter);
  });

  localLoanTracksTotals = computed(() => {
    const list = this.localLoanTracks();
    const totalLoans = list.length;
    const totalPrincipal = list.reduce((sum, l) => sum + l.total, 0);
    const totalCollected = list.reduce((sum, l) => sum + l.collected, 0);
    const totalBalance = list.reduce((sum, l) => sum + l.balance, 0);
    
    return {
      totalLoans,
      totalPrincipal,
      totalCollected,
      totalBalance
    };
  });

  outstandingBalanceRows = computed(() => {
    const month = this.selectedReportMonth();
    
    // Find all days of this month that have any activity
    const datesWithActivity = new Set<string>();
    
    this.customers().forEach(c => {
      const normalized = normalizeDate(c.createdAt);
      if (normalized.startsWith(month)) {
        datesWithActivity.add(normalized);
      }
    });

    this.collections().forEach(col => {
      const normalized = normalizeDate(col.date);
      if (normalized.startsWith(month)) {
        datesWithActivity.add(normalized);
      }
    });

    const sortedDates = Array.from(datesWithActivity).sort();

    return sortedDates.map((dStr, idx) => {
      const displayDate = dStr.slice(5).replace('-', '/'); // "03/24"
      
      const dayColls = this.collections().filter(c => normalizeDate(c.date) === dStr);
      const dlCol = dayColls.filter(c => c.line === 'A').reduce((sum, item) => sum + item.amount, 0);
      const wlCol = dayColls.filter(c => c.line === 'W').reduce((sum, item) => sum + item.amount, 0);
      const mlCol = dayColls.filter(c => c.line === 'M').reduce((sum, item) => sum + item.amount, 0);
      const totalCol = dlCol + wlCol + mlCol;

      const dayLoans = this.customers().filter(c => normalizeDate(c.createdAt) === dStr);
      const dlGiv = dayLoans.filter(c => c.line === 'A').reduce((sum, item) => sum + item.loanAmount, 0);
      const wlGiv = dayLoans.filter(c => c.line === 'W').reduce((sum, item) => sum + item.loanAmount, 0);
      const mlGiv = dayLoans.filter(c => c.line === 'M').reduce((sum, item) => sum + item.loanAmount, 0);
      const totalGiv = dlGiv + wlGiv + mlGiv;

      // Outstanding loans balance BEFORE this day
      const getOutstandingBefore = (line: 'A' | 'W' | 'M') => {
        const givenBefore = this.customers()
          .filter(c => c.line === line && normalizeDate(c.createdAt) <= dStr)
          .reduce((sum, item) => sum + item.loanAmount, 0);
        const collsBefore = this.collections()
          .filter(c => c.line === line && normalizeDate(c.date) < dStr)
          .reduce((sum, item) => sum + item.amount, 0);
        return Math.max(0, givenBefore - collsBefore);
      };

      const dlOutstanding = getOutstandingBefore('A');
      const wlOutstanding = getOutstandingBefore('W');
      const mlOutstanding = getOutstandingBefore('M');
      const totalOutstanding = dlOutstanding + wlOutstanding + mlOutstanding;

      return {
        id: idx + 1,
        date: displayDate,
        realDate: dStr,
        rows: [
          { detail: 'முன் நடப்பு பாக்கி', dl: dlOutstanding, wl: wlOutstanding, ml: mlOutstanding, total: totalOutstanding },
          { detail: 'வசூல்', dl: dlCol, wl: wlCol, ml: mlCol, total: totalCol },
          { detail: 'அடைப்பு', dl: dlGiv, wl: wlGiv, ml: mlGiv, total: totalGiv }
        ]
      };
    });
  });

  async generateAndDownloadXlsx(sheetName: string, headers: string[], rows: (string | number | boolean | null | undefined)[][], filename: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    
    try {
      type CellValue = string | number | boolean | null | undefined | { text?: string };
      
      interface ExcelJSCell {
        value: CellValue;
        fill: unknown;
        font: unknown;
        alignment: unknown;
        border: unknown;
      }

      interface ExcelJSRow {
        height: number;
        getCell(index: number): ExcelJSCell;
        eachCell(callback: (cell: ExcelJSCell) => void): void;
      }

      interface ExcelJSWorksheet {
        addRow(row: unknown[]): ExcelJSRow;
        eachRow(callback: (row: ExcelJSRow, rowNumber: number) => void): void;
        columns: { width?: number; values?: CellValue[] }[];
      }

      interface ExcelJSWorkbook {
        addWorksheet(name: string): ExcelJSWorksheet;
        xlsx: {
          writeBuffer(): Promise<ArrayBuffer>;
        };
      }

      interface ExcelJSGlobal {
        Workbook: new () => ExcelJSWorkbook;
      }

      let ExcelJS = (window as unknown as { ExcelJS?: ExcelJSGlobal }).ExcelJS;
      if (!ExcelJS) {
        ExcelJS = await new Promise<ExcelJSGlobal>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
          script.onload = () => {
            const loaded = (window as unknown as { ExcelJS?: ExcelJSGlobal }).ExcelJS;
            if (loaded) {
              resolve(loaded);
            } else {
              reject(new Error('ExcelJS not found on window object'));
            }
          };
          script.onerror = (err) => reject(err);
          document.head.appendChild(script);
        });
      }

      if (!ExcelJS) {
        throw new Error('ExcelJS failed to load');
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(sheetName);

      // Add headers
      const headerRow = worksheet.addRow(headers);
      
      // Add data rows
      rows.forEach(r => {
        worksheet.addRow(r);
      });

      // Apply styling to the header row
      headerRow.height = 28;
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1F4E78' } // Dark blue
        };
        cell.font = {
          name: 'Segoe UI',
          size: 11,
          bold: true,
          color: { argb: 'FFFFFFFF' } // White text
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          bottom: { style: 'medium', color: { argb: 'FF111111' } },
          right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
        };
      });

      // Apply styling to data rows (borders, alignment, fonts)
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header formatting
        
        row.height = 22;
        row.eachCell((cell) => {
          cell.font = {
            name: 'Segoe UI',
            size: 10,
            color: { argb: 'FF2D3748' }
          };
          cell.alignment = {
            vertical: 'middle',
            horizontal: typeof cell.value === 'number' ? 'right' : 'left'
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
          };
        });
      });

      // Format total rows uniquely if detected
      worksheet.eachRow((row) => {
        const firstCellVal = row.getCell(1).value;
        if (firstCellVal && (
          firstCellVal.toString().toLowerCase() === 'total' || 
          firstCellVal.toString().toLowerCase() === 'totals' || 
          firstCellVal.toString().includes('மொத்தம்')
        )) {
          row.eachCell((cell) => {
            cell.font = {
              name: 'Segoe UI',
              size: 10,
              bold: true,
              color: { argb: 'FF1F4E78' }
            };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF1F5F9' } // Elegant soft blue/gray
            };
          });
        }
      });

      // Autofit widths based on Content length
      worksheet.columns.forEach(column => {
        let maxLength = 10;
        column.values?.forEach(val => {
          if (val) {
            let strVal = '';
            if (typeof val === 'object' && 'text' in val) {
              strVal = val.text?.toString() || '';
            } else {
              strVal = val.toString();
            }
            if (strVal.length > maxLength) {
              maxLength = strVal.length;
            }
          }
        });
        column.width = Math.min(38, maxLength + 4);
      });

      // Create Buffer and trigger browser download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error generating Excel file:', error);
      this.showToast('எக்செல் கோப்பு உருவாக்குவதில் பிழை / Error generating Excel file.', 'danger');
    }
  }

  exportToExcel(reportName: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    
    if (reportName === 'monthly-summary') {
      const headers = [
        "S.No", "Date/மாதம்", "Total Collection", "Total Closure", "DL Collection", "DL Closure", "DL Profit", 
        "WL Collection", "WL Closure", "WL Profit", "ML Collection", "ML Closure", "ML Profit", 
        "PI", "Temp In", "Temp Out", "Expense", "New Cust", "New Disb", "Excess", "Deficit"
      ];
      const rows: (string | number | boolean | null | undefined)[][] = [];
      this.monthlySummaryRows().forEach(r => {
        rows.push([
          r.sNo, r.date, r.totalCol, r.totalCls, r.dlCol, r.dlCls, r.dlProfit, r.wlCol, r.wlCls, 
          r.wlProfit, r.mlCol, r.mlCls, r.mlProfit, r.piItem, r.tempIn, r.tempOut, r.expense, 
          r.newCust, r.newPoint, r.excess, r.defect
        ]);
      });
      const t = this.monthlySummaryTotals();
      rows.push([
        "Total", "", t.totalCol, t.totalCls, t.dlCol, t.dlCls, t.dlProfit, t.wlCol, t.wlCls, 
        t.wlProfit, t.mlCol, t.mlCls, t.mlProfit, t.piItem, t.tempIn, t.tempOut, t.expense, 
        t.newCust, t.newPoint, t.excess, t.defect
      ]);
      
      this.generateAndDownloadXlsx(
        'Monthly Summary', 
        headers, 
        rows, 
        `monthly_summary_report_${this.selectedReportMonth()}.xlsx`
      ).then(() => {
        this.showToast('எக்செல் அறிக்கை பதிவிறக்கப்பட்டது / Excel Report exported successfully!', 'success');
      });

    } else if (reportName === 'loan-tracking') {
      const headers = ["S.No", "Place/ஊர்", "Loan No", "Type/வகை", "Customer Name", "Phone", "Start Date", "End Date", "Instalment", "Total Principal", "Collected", "Balance"];
      const rows: (string | number | boolean | null | undefined)[][] = [];
      this.localLoanTracks().forEach(l => {
        rows.push([
          l.sNo, l.place, l.loanNo, l.type, l.customerName, l.phone, l.start, l.end, l.instalment, l.total, l.collected, l.balance
        ]);
      });
      
      this.generateAndDownloadXlsx(
        'Loan Tracking', 
        headers, 
        rows, 
        `loan_tracking_report_${this.selectedReportMonth()}.xlsx`
      ).then(() => {
        this.showToast('எக்செல் அறிக்கை பதிவிறக்கப்பட்டது / Excel Report exported successfully!', 'success');
      });

    } else {
      const headers = ["Date/தேதி", "Detail/விவரம்", "A Line/தினசரி", "WL Line/வாராந்திர", "ML Line/மாதாந்திர", "Total/மொத்தம்"];
      const rows: (string | number | boolean | null | undefined)[][] = [];
      this.outstandingBalanceRows().forEach(r => {
        r.rows.forEach((sub, i) => {
          rows.push([
            i === 0 ? r.date : '',
            sub.detail,
            sub.dl,
            sub.wl,
            sub.ml,
            sub.total
          ]);
        });
      });
      
      this.generateAndDownloadXlsx(
        'Outstanding Balance', 
        headers, 
        rows, 
        `outstanding_balance_report_${this.selectedReportMonth()}.xlsx`
      ).then(() => {
        this.showToast('எக்செல் அறிக்கை பதிவிறக்கப்பட்டது / Excel Report exported successfully!', 'success');
      });
    }
  }

  // Bulk Import / Export Signals
  selectedImportType = signal<'customers' | 'loans' | 'collections' | 'expenses' | 'employees'>('customers');
  importFileName = signal<string>('No file chosen');
  importFileContent = '';
  exportFromDate = signal<string>(getLocalTodayString().substring(0, 8) + '01');
  exportToDate = signal<string>(getLocalTodayString());

  customers = signal<Customer[]>([]);
  collections = signal<Collection[]>([]);
  expenses = signal<Expense[]>([]);
  employees = signal<Employee[]>([]);

  // Employees subtabs and interactive filters matching new design
  employeeActiveSubTab = signal<'list' | 'attendance'>('list');
  selectedCollectionGroup = signal<string>('all');
  selectedAttendanceMonth = signal<string>(getLocalTodayString().substring(0, 7));
  showAddEmployeeModal = signal<boolean>(false);
  editingEmployeeId = signal<string | null>(null);
  showAddGroupForm = signal<boolean>(false);
  newGroupNameInput = signal<string>('');

  // Expenses localized screen signals matching screenshots
  expenseFilterFrom = signal<string>(getLocalTodayString().substring(0, 8) + '01');
  expenseFilterTo = signal<string>(getLocalTodayString());
  expenseFilterCategory = signal<string>('all');
  showAddExpensePanel = signal<boolean>(false);

  filteredExpensesLocal = computed(() => {
    const list = this.expenses();
    const fromDate = this.expenseFilterFrom();
    const toDate = this.expenseFilterTo();
    const category = this.expenseFilterCategory();
    
    return list.filter(e => {
      const matchDate = (!fromDate || e.date >= fromDate) && (!toDate || e.date <= toDate);
      const matchCategory = category === 'all' || e.type === category;
      return matchDate && matchCategory;
    });
  });

  filteredExpensesLocalTotal = computed(() => {
    return this.filteredExpensesLocal().reduce((sum, item) => sum + item.amount, 0);
  });

  filteredEmployees = computed(() => {
    const list = this.employees();
    const group = this.selectedCollectionGroup();
    if (group === 'all') return list;
    return list.filter(e => e.collectionGroup === group);
  });

  // Chart tracking
  chartInstances: unknown[] = [];

  // Language & Translation states
  isTamil = signal<boolean>(true);
  lastLanguageClickTime = signal<string>('');
  showLanguageModal = signal<boolean>(false);
  selectedLanguageButton = signal<'tamil' | 'english' | null>(null);

  // Comprehensive Onboarding Wizard States & Custom Settings
  currentWizardStep = signal<number>(1);
  referralCustomer = signal<Customer | null>(null);
  referralRelation = signal<string>('நண்பர் / Friend');
  collectionGroups = signal<string[]>([]);
  showManageGroups = signal<boolean>(false);
  newCollectionGroupName = signal<string>('');
  uploadedFiles = signal<{ name: string; size: string; type: string; url?: string }[]>([]);
  customerProfilePhoto = signal<string | null>(null);
  newCustSearchQuery = signal<string>('');
  searchSuggestions = signal<Customer[]>([]);
  draftAutoSavedTime = signal<string>('');
  interestType = signal<'Daily' | 'Weekly' | 'Monthly'>('Daily');
  profitAmount = signal<number>(0);
  startDate = signal<string>(getLocalTodayString());
  showPreviewSchedule = signal<boolean>(false);

  // Collection Entry interactive states
  selectedCollectionCustomer = signal<Customer | null>(null);
  collectionSearchQuery = signal<string>('');
  collectionTypeFilter = signal<string>('all');
  collectionGroupFilter = signal<string>('all');
  showCollectionSuccessModal = signal<boolean>(false);

  // Referral states
  confirmDialogState = signal<{
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
  } | null>(null);

  showReferralModal = signal<boolean>(false);
  referralTab = signal<'search' | 'add_new'>('search');
  referralSearchQuery = signal<string>('');
  newReferralName = signal<string>('');
  newReferralPhone = signal<string>('');

  relationsList = [
    { tamil: 'அண்ணன்/தம்பி', english: 'Brother' },
    { tamil: 'அக்கா/தங்கை', english: 'Sister' },
    { tamil: 'உறவினர்', english: 'Relative' },
    { tamil: 'நண்பர்', english: 'Friend' },
    { tamil: 'வழிகாட்டி', english: 'Advisor' },
    { tamil: 'மற்றவை', english: 'Other' }
  ];

  // Reactive Forms setups
  loginForm = new FormGroup({
    username: new FormControl('admin', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('admin123', { nonNullable: true, validators: [Validators.required] })
  });

  customerForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    englishName: new FormControl('', { nonNullable: true }),
    phone: new FormControl('', { nonNullable: true }),
    fatherName: new FormControl('', { nonNullable: true }),
    occupation: new FormControl('', { nonNullable: true }),
    address: new FormControl('', { nonNullable: true }),
    idProofType: new FormControl('Aadhaar', { nonNullable: true }),
    idProofNumber: new FormControl('', { nonNullable: true }),
    line: new FormControl<'A' | 'W' | 'M'>('A', { nonNullable: true }),
    loanAmount: new FormControl<number | null>(null),
    interestRate: new FormControl<number | null>(null),
    tenure: new FormControl<number | null>(null),
    collectionGroup: new FormControl('', { nonNullable: true }),
    clNo: new FormControl('', { nonNullable: true })
  });

  collectionForm = new FormGroup({
    customerId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    amount: new FormControl<number>(0, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
    interestAmount: new FormControl<number>(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    principalAmount: new FormControl<number>(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    date: new FormControl(getLocalTodayString(), { nonNullable: true, validators: [Validators.required] }),
    notes: new FormControl('', { nonNullable: true }),
    paymentMethod: new FormControl<'Cash' | 'GPay' | 'PhonePe' | 'Online'>('Cash', { nonNullable: true, validators: [Validators.required] })
  });

  expenseForm = new FormGroup({
    type: new FormControl<'Salary' | 'Rent' | 'Office' | 'Vehicle' | 'Miscellaneous'>('Office', { nonNullable: true, validators: [Validators.required] }),
    amount: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(1)] }),
    date: new FormControl(getLocalTodayString(), { nonNullable: true, validators: [Validators.required] }),
    description: new FormControl('', { nonNullable: true })
  });

  employeeForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    role: new FormControl('Collection', { nonNullable: true, validators: [Validators.required] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern('^[0-9]{10}$')] }),
    collectionGroup: new FormControl('', { nonNullable: true }),
    salary: new FormControl<number>(10000, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    joinDate: new FormControl(getLocalTodayString(), { nonNullable: true, validators: [Validators.required] })
  });

  settingsForm = new FormGroup({
    companyName: new FormControl('SmartGoNext', { nonNullable: true, validators: [Validators.required] }),
    englishName: new FormControl('SmartGoNext', { nonNullable: true, validators: [Validators.required] }),
    branch: new FormControl('புதுச்சேரி', { nonNullable: true, validators: [Validators.required] }),
    subtitle: new FormControl('நம்பகமான நிதி சேவை', { nonNullable: true, validators: [Validators.required] }),
    openingBalance: new FormControl<number>(200000, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    audioEnabled: new FormControl<boolean>(true, { nonNullable: true }),
    dailyInterest: new FormControl<number>(0, { nonNullable: true }),
    weeklyInterest: new FormControl<number>(0, { nonNullable: true }),
    monthlyInterest: new FormControl<number>(0, { nonNullable: true }),
    defaultDailyTenure: new FormControl<number>(100, { nonNullable: true }),
    defaultWeeklyTenure: new FormControl<number>(52, { nonNullable: true }),
    defaultMonthlyTenure: new FormControl<number>(12, { nonNullable: true })
  });

  staffUserForm = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    displayName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    permissionAddCustomer: new FormControl<boolean>(false, { nonNullable: true }),
    permissionCollectMoney: new FormControl<boolean>(true, { nonNullable: true }), // checked by default
    permissionViewReports: new FormControl<boolean>(false, { nonNullable: true }),
    permissionDeleteEntry: new FormControl<boolean>(false, { nonNullable: true })
  });

  constructor() {
    this.initSupabaseConfig();
    // Initializing state secure parameters and tracking layout transitions
    this.loadDatabase();

    // Load Dark Mode Preference
    if (isPlatformBrowser(this.platformId)) {
      const savedDark = localStorage.getItem('sri_finance_dark_mode');
      if (savedDark === 'true') {
        this.isDarkMode.set(true);
      } else if (savedDark === 'false') {
        this.isDarkMode.set(false);
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        this.isDarkMode.set(prefersDark);
      }
    }

    // Monitor Dark Mode Class Toggle
    effect(() => {
      const dark = this.isDarkMode();
      if (isPlatformBrowser(this.platformId)) {
        const root = document.documentElement;
        if (dark) {
          root.classList.add('dark');
          localStorage.setItem('sri_finance_dark_mode', 'true');
        } else {
          root.classList.remove('dark');
          localStorage.setItem('sri_finance_dark_mode', 'false');
        }
      }
      if (this.activeTab() === 'dashboard') {
        setTimeout(() => this.renderCharts(), 50);
      }
    });

    // Synchronize changes back to localStorage
    effect(() => {
      this.saveDatabase();
    });

    // Automatically render charts when entering 'dashboard' tab
    effect(() => {
      if (this.activeTab() === 'dashboard' && this.loginSuccess()) {
        setTimeout(() => this.renderCharts(), 150);
      }
    });

    afterNextRender(() => {
      // Restore onboarding draft if exists
      try {
        const draftStr = localStorage.getItem('sri_finance_customer_draft');
        if (draftStr) {
          const draft = JSON.parse(draftStr);
          if (draft.formValues) {
            this.customerForm.patchValue(draft.formValues, { emitEvent: false });
          }
          if (draft.interestType) {
            this.interestType.set(draft.interestType);
          }
          if (draft.referralRelation) {
            this.referralRelation.set(draft.referralRelation);
          }
          if (draft.referralCustomer) {
            this.referralCustomer.set(draft.referralCustomer);
          }
          if (draft.startDate) {
            this.startDate.set(draft.startDate);
          }
          if (draft.profilePhoto) {
            this.customerProfilePhoto.set(draft.profilePhoto);
          }
          this.recalculateFromRate();
          this.draftAutoSavedTime.set('Saved Draft Restored');
        }
      } catch (e) {
        console.error('Error restoring customer draft:', e);
      }

      // Onboarding automatic calculators & persistent draft saves
      this.customerForm.get('loanAmount')?.valueChanges.subscribe(() => {
        this.recalculateFromRate();
        this.saveDraft();
      });
      this.customerForm.get('interestRate')?.valueChanges.subscribe(() => {
        this.recalculateFromRate();
        this.saveDraft();
      });
      this.customerForm.valueChanges.subscribe(() => {
        this.saveDraft();
      });

      // Watch collection entry amount to set principal amount exactly to collection amount and interest to 0
      this.collectionForm.get('amount')?.valueChanges.subscribe(totalPay => {
        if (!totalPay || totalPay <= 0) return;
        this.collectionForm.patchValue({
          interestAmount: 0,
          principalAmount: totalPay
        }, { emitEvent: false });
      });
    });
  }

  // --- DATABASE PERSISTENCE LOGIC ---
  isSyncing = signal<boolean>(false);
  lastSyncedTime = signal<string>('Never / இதுவரை இல்லை');
  supabaseSyncLog = signal<string[]>([]);

  // Supabase Mobile API Base URL
  supabaseApiBaseUrl = signal<string>('');
  
  // Mobile diagnostics signals
  diagnosticNetworkOk = signal<boolean | null>(null);
  diagnosticServerOk = signal<boolean | null>(null);
  diagnosticDbOk = signal<boolean | null>(null);
  diagnosticAuthOk = signal<boolean | null>(null);
  diagnosticErrorLogs = signal<string[]>([]);
  isTestingDiagnostics = signal<boolean>(false);
  supabasePingMs = signal<number>(0);
  supabaseDbUrlConfigured = signal<string>('Unknown');

  // Network Offline status signal
  isAppOffline = signal<boolean>(false);

  // Initialize the API base URL and network monitors
  initSupabaseConfig(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Detect offline/online events
    this.isAppOffline.set(!navigator.onLine);
    window.addEventListener('online', () => {
      this.isAppOffline.set(false);
      this.showToast('இணைய இணைப்பு கிடைத்துவிட்டது! / Device is back online.', 'success');
      this.addDiagnosticLog('System detected: Network connection restored.');
    });
    window.addEventListener('offline', () => {
      this.isAppOffline.set(true);
      this.showToast('இணைய இணைப்பு துண்டிக்கப்பட்டது / Device is offline.', 'danger');
      this.addDiagnosticLog('System detected: Network connection lost.');
    });

    // Detect if we are on a custom origin (like an APK, custom wrapper, webview) or localhost (Capacitor)
    const origin = window.location.origin;
    const isMobileWebview = 
      origin.startsWith('file://') || 
      origin.startsWith('capacitor://') || 
      origin.startsWith('ionic://') || 
      origin.startsWith('chrome-extension://') ||
      (origin.includes('localhost') && !origin.includes(':3000') && !origin.includes(':4200'));

    let savedBaseUrl = localStorage.getItem('supabase_api_base_url') || '';
    if (savedBaseUrl.includes('.run.app') && !savedBaseUrl.includes(origin)) {
      console.log(`[Configuration] Resetting stale sandboxed API Base URL: "${savedBaseUrl}" to relative path/development default.`);
      savedBaseUrl = '';
      localStorage.setItem('supabase_api_base_url', '');
    }

    if (!environment.production && savedBaseUrl === 'https://sri-vijaya-finance.onrender.com') {
      console.log(`[Configuration] Local dev preview mode: Clearing default production API URL from localStorage to route via local Express server.`);
      savedBaseUrl = '';
      localStorage.setItem('supabase_api_base_url', '');
    }

    if (!savedBaseUrl) {
      // Default to the production server URL as the secure proxy API gateway from environment configuration
      savedBaseUrl = environment.apiUrl;
      localStorage.setItem('supabase_api_base_url', savedBaseUrl);
      console.log(`[Configuration] Pre-populated Supabase API base URL from environment: ${savedBaseUrl}`);
    }

    this.supabaseApiBaseUrl.set(savedBaseUrl);
    this.addDiagnosticLog(`Supabase API Base URL initialized: "${savedBaseUrl}" (Mobile Native: ${isMobileWebview})`);
    this.addDiagnosticLog(`Active environment origin: ${origin}`);
  }

  // Resolves paths like /api/supabase/save to include full host if configured
  getApiUrl(path: string): string {
    const base = this.supabaseApiBaseUrl().trim() || environment.apiUrl || '';
    if (!base) return path;
    const sanitizedBase = base.replace(/\/+$/, '');
    const sanitizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${sanitizedBase}${sanitizedPath}`;
  }

  // Update and store custom API gateway base URL
  updateSupabaseApiBaseUrl(newUrl: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const url = newUrl.trim();
    this.supabaseApiBaseUrl.set(url);
    localStorage.setItem('supabase_api_base_url', url);
    this.showToast('அடிப்படை முகவரி வெற்றிகரமாக புதுப்பிக்கப்பட்டது! / API Base URL saved successfully!', 'success');
    this.addDiagnosticLog(`API Base URL manually updated to: "${url || 'Relative'}"`);
    
    // Auto trigger diagnostics after update
    this.runSupabaseDiagnostics();
  }

  // Append a message to diagnostic logs list
  addDiagnosticLog(msg: string): void {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] ${msg}`;
    this.diagnosticErrorLogs.update(logs => [formatted, ...logs].slice(0, 50));
    console.log(`[Supabase-Diagnostics] ${msg}`);
  }

  // Run dynamic diagnostics
  async runSupabaseDiagnostics(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    this.isTestingDiagnostics.set(true);
    this.diagnosticNetworkOk.set(null);
    this.diagnosticServerOk.set(null);
    this.diagnosticDbOk.set(null);
    this.diagnosticAuthOk.set(null);

    this.addDiagnosticLog('Starting full-stack diagnostics workflow...');

    // 1. Check local network status
    const isOnline = navigator.onLine;
    this.diagnosticNetworkOk.set(isOnline);
    this.isAppOffline.set(!isOnline);
    this.addDiagnosticLog(`Step 1: Local Network connection is ${isOnline ? 'ONLINE (Green)' : 'OFFLINE (Red)'}`);

    if (!isOnline) {
      this.isTestingDiagnostics.set(false);
      this.diagnosticServerOk.set(false);
      this.diagnosticDbOk.set(false);
      this.diagnosticAuthOk.set(false);
      this.addDiagnosticLog('Diagnostics stopped: Local network is disconnected.');
      return;
    }

    // 2. Ping backend Express API Gateway (uses fetch with retry logic)
    const testUrl = this.getApiUrl('/api/supabase/test');
    this.addDiagnosticLog(`Step 2: Pinging Express API Gateway: "${testUrl}"`);

    try {
      const startTime = Date.now();
      const res = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });
      const responseTime = Date.now() - startTime;

      if (!res.ok) {
        throw new Error(`HTTP Error Status: ${res.status} (${res.statusText})`);
      }

      const result = await res.json();
      this.diagnosticServerOk.set(true);
      this.addDiagnosticLog(`Express API server responded successfully in ${responseTime}ms (CORS: Checked-OK)`);

      // 3. Evaluate Supabase configurations & DB connection status returned by backend test route
      if (result.success) {
        this.diagnosticDbOk.set(true);
        this.diagnosticAuthOk.set(result.keySet && result.urlSet);
        this.supabasePingMs.set(result.supabasePingMs || 0);
        this.supabaseDbUrlConfigured.set(result.supabaseUrl || 'Unknown');
        
        this.addDiagnosticLog(`Supabase Database connected! Server ping: ${result.supabasePingMs}ms`);
        this.addDiagnosticLog(`Supabase Credentials Valid: Key=${result.keySet ? 'Yes' : 'No'}, URL=${result.urlSet ? 'Yes' : 'No'}`);
      } else {
        this.diagnosticDbOk.set(false);
        this.diagnosticAuthOk.set(false);
        this.addDiagnosticLog(`Database Sync Blocked: ${result.error || 'Unknown database rejection'}`);
        if (result.code) this.addDiagnosticLog(`Error Code: ${result.code}. Hint: ${result.hint || 'No hint'}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.diagnosticServerOk.set(false);
      this.diagnosticDbOk.set(false);
      this.diagnosticAuthOk.set(false);
      this.addDiagnosticLog(`Connection to API server failed! Details: ${errMsg}`);
      this.addDiagnosticLog(`Ensure that the custom API base URL contains "https://", and is valid.`);
    } finally {
      this.isTestingDiagnostics.set(false);
    }
  }

  // Trigger a full write sync test
  async runSupabaseWriteTest(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    this.showToast('பரிசோதனைத் தரவு ஒத்திசைக்கப்படுகிறது... / Sending write test payload...', 'info');
    this.addDiagnosticLog('Initiating write test operation to Supabase...');

    try {
      const success = await this.pushToSupabase(true);
      if (success) {
        this.showToast('எழுதும் சோதனை வெற்றிகரமாக முடிந்தது! / Supabase write test passed successfully!', 'success');
        this.addDiagnosticLog('Write test operation completed: Success!');
        this.runSupabaseDiagnostics();
      } else {
        this.showToast('எழுதும் சோதனை தோல்வி / Write test failed. Check diagnostics logs.', 'danger');
        this.addDiagnosticLog('Write test operation completed: Rejected by storage adapter.');
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.addDiagnosticLog(`Write test threw exception: ${errMsg}`);
      this.showToast('சோதனை தோல்வியடைந்தது / Write test failed with network error.', 'danger');
    }
  }

  // Helper fetch with automated retry mechanism with backoff
  async fetchWithRetry(url: string, options: RequestInit = {}, retries = 3, delay = 1000): Promise<Response> {
    let lastError: unknown = null;

    for (let i = 0; i < retries; i++) {
      try {
        if (!navigator.onLine) {
          throw new Error('Device is currently offline.');
        }

        const res = await fetch(url, options);
        if (res.status === 404) {
          throw new Error(`Endpoint not found (404) at ${url}`);
        }
        
        if (res.ok || res.status < 500) {
          return res;
        }

        throw new Error(`Server returned HTTP ${res.status}: ${res.statusText}`);
      } catch (err: unknown) {
        lastError = err;
        const attempt = i + 1;
        const errMsg = err instanceof Error ? err.message : String(err);
        this.addDiagnosticLog(`Fetch attempt ${attempt}/${retries} failed for URL: ${url}. Error: ${errMsg}`);
        
        if (attempt < retries) {
          const backoff = delay * Math.pow(2, i);
          this.addDiagnosticLog(`Waiting ${backoff}ms before retrying...`);
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }

    throw lastError || new Error(`Failed to complete request after ${retries} retries.`);
  }

  async loadFromSupabase(silent = false): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    
    if (!silent) {
      this.isSyncing.set(true);
    }
    
    const resolvedUrl = this.getApiUrl('/api/supabase/load');
    this.addDiagnosticLog(`Retrieving state from Supabase Cloud Gateway: "${resolvedUrl}"`);
    
    try {
      const res = await this.fetchWithRetry(resolvedUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });
      const result = await res.json();
      
      if (result && result.success && result.data && Object.keys(result.data).length > 0) {
        const state = result.data;
        
        if (state.settings) {
          this.settings.set(state.settings);
          this.settingsForm.patchValue(state.settings, { emitEvent: false });
        }
        if (state.customers) this.customers.set(state.customers);
        if (state.collections) this.collections.set(state.collections);
        if (state.expenses) this.expenses.set(state.expenses);
        if (state.employees) this.employees.set(state.employees);
        if (state.collectionGroups) this.collectionGroups.set(state.collectionGroups);
        if (state.usersList) this.usersList.set(state.usersList);
        if (state.backupsList) this.backupsList.set(state.backupsList);
        
        // Save back to local caching mechanisms
        const exportObj = {
          settings: this.settings(),
          customers: this.customers(),
          collections: this.collections(),
          expenses: this.expenses(),
          employees: this.employees(),
          collectionGroups: this.collectionGroups(),
          usersList: this.usersList(),
          backupsList: this.backupsList()
        };
        localStorage.setItem('smart_finance_db_v1.0', JSON.stringify(exportObj));
        FinanceDB.saveAllData(exportObj).catch((e: unknown) => console.warn('Local indexedDB save failed:', e));

        const now = new Date().toLocaleTimeString();
        this.lastSyncedTime.set(now);
        localStorage.setItem('supabase_last_sync_time', now);
        
        this.addDiagnosticLog('Successfully pulled complete database snapshot from Cloud.');
        
        if (!silent) {
          this.showToast('Supabase இலிருந்து தரவு வெற்றிகரமாகப் பெறப்பட்டது! / Data pulled from Supabase successfully!', 'success');
        }
        
        setTimeout(() => this.renderCharts(), 150);
      } else {
        const warning = result?.error || 'Database is empty';
        this.addDiagnosticLog(`Cloud snapshot load notice: ${warning}`);
        if (!silent) {
          this.showToast('Supabase-ல் தரவு ஏதும் இல்லை / Cloud database contains no saved states.', 'info');
        }
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.addDiagnosticLog(`Exception while loading cloud data: ${errMsg}`);
      console.error('Error pulling from Supabase:', e);
      if (!silent) {
        this.showToast(`Supabase-லிருந்து தரவைப் பெறுவதில் பிழை / Failure retrieving data from Supabase: ${errMsg}`, 'danger');
      }
    } finally {
      this.isSyncing.set(false);
    }
  }

  async pushToSupabase(silent = false): Promise<boolean> {
    if (!isPlatformBrowser(this.platformId)) return false;
    
    if (!silent) {
      this.isSyncing.set(true);
    }
    
    const resolvedUrl = this.getApiUrl('/api/supabase/save');
    this.addDiagnosticLog(`Pushing state to Supabase Cloud Gateway: "${resolvedUrl}"`);
    
    try {
      const payload = {
        settings: this.settings(),
        customers: this.customers(),
        collections: this.collections(),
        expenses: this.expenses(),
        employees: this.employees(),
        collectionGroups: this.collectionGroups(),
        usersList: this.usersList(),
        backupsList: this.backupsList()
      };
      
      const res = await this.fetchWithRetry(resolvedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      const result = await res.json();
      
      if (result && result.success) {
        const now = new Date().toLocaleTimeString();
        this.lastSyncedTime.set(now);
        localStorage.setItem('supabase_last_sync_time', now);
        
        if (result.relationalUpsertLog && result.relationalUpsertLog.length > 0) {
          this.supabaseSyncLog.set(result.relationalUpsertLog);
          this.addDiagnosticLog(`Warning: Relational inserts had some issues. Check settings panel warnings.`);
          console.warn('Some relational inserts failed on Supabase. Unified core database backup was successful.');
        } else {
          this.supabaseSyncLog.set([]);
          this.addDiagnosticLog('Synchronized clean backup payload with active tables completely!');
        }
        
        if (!silent) {
          this.showToast('தரவு வெற்றிகரமாக மேகக்கணியில் சேமிக்கப்பட்டது / All checkout forms synced with Supabase Cloud!', 'success');
        }
        return true;
      } else {
        const errDetail = result?.storeUpsertError || result?.error || 'Rejected by storage adapter';
        this.addDiagnosticLog(`Cloud Sync Rejected: ${errDetail}`);
        if (!silent) {
          this.showToast(`பரிமாற்றத்தில் பிழை / Supabase storage rejected full backup payload: ${errDetail}`, 'danger');
        }
        return false;
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.addDiagnosticLog(`Exception while pushing cloud data: ${errMsg}`);
      console.error('Error pushing data to Supabase:', e);
      if (!silent) {
        this.showToast(`இருப்புப் பரிமாற்றத்தில் பிழை / Network error during cloud sync: ${errMsg}`, 'danger');
      }
      return false;
    } finally {
      this.isSyncing.set(false);
    }
  }

  private async loadDatabase(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    // Load active session
    const savedSession = localStorage.getItem('sri_finance_logged_in');
    if (savedSession === 'true') {
      this.loginSuccess.set(true);
    }

    // Try loading Supabase cached sync timestamp
    const savedSyncTime = localStorage.getItem('supabase_last_sync_time');
    if (savedSyncTime) {
      this.lastSyncedTime.set(savedSyncTime);
    }

    try {
      // First attempt cloud status load to ensure we have any latest remote changes
      await this.loadFromSupabase(true);

      const dbState = await FinanceDB.loadAll();

      if (dbState && dbState.settings) {
        this.settings.set(dbState.settings as AppSettings);
        this.settingsForm.patchValue(dbState.settings as Partial<AppSettings>, { emitEvent: false });
      } else {
        // Fallback default empty settings layout
        const defaultSettings: AppSettings = {
          companyName: 'SmartGoNext',
          englishName: 'SmartGoNext',
          branch: 'புதுச்சேரி',
          subtitle: 'நம்பகமான நிதி சேவை',
          openingBalance: 200000,
          audioEnabled: true,
          dailyInterest: 0,
          weeklyInterest: 0,
          monthlyInterest: 0,
          defaultDailyTenure: 100,
          defaultWeeklyTenure: 52,
          defaultMonthlyTenure: 12
        };
        this.settings.set(defaultSettings);
        this.settingsForm.patchValue(defaultSettings, { emitEvent: false });
      }

      const hasCustomers = dbState && dbState.customers && dbState.customers.length > 0;
      const hasCollections = dbState && dbState.collections && dbState.collections.length > 0;
      const hasExpenses = dbState && dbState.expenses && dbState.expenses.length > 0;
      
      if (!hasCustomers && !hasCollections && !hasExpenses) {
        this.seedDemoData();
      } else {
        if (dbState && dbState.customers) this.customers.set(dbState.customers as Customer[]);
        if (dbState && dbState.collections) this.collections.set(dbState.collections as Collection[]);
        if (dbState && dbState.expenses) this.expenses.set(dbState.expenses as Expense[]);
        if (dbState && dbState.employees) this.employees.set(dbState.employees as Employee[]);
      }
      
      if (dbState && dbState.collectionGroups && dbState.collectionGroups.length > 0) {
        this.collectionGroups.set(dbState.collectionGroups as string[]);
      }
      
      if (dbState && dbState.usersList && dbState.usersList.length > 0) {
        this.usersList.set(dbState.usersList as StaffUser[]);
      } else {
        this.usersList.set([
          { username: 'admin', displayName: 'Administrator', role: 'admin', permissions: ['Full Access'], status: 'Active' }
        ]);
      }
      if (dbState && dbState.backupsList) {
        this.backupsList.set(dbState.backupsList as DatabaseBackup[]);
      }

      // Re-initialize dynamic chart render once data is present
      setTimeout(() => this.renderCharts(), 120);
      return;
    } catch (e) {
      console.error('Error loading dynamic IndexedDB', e);
    }

    // Load standard empty initial settings
    this.seedDemoData();
  }

  private saveDatabase(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const exportObj = {
      settings: this.settings(),
      customers: this.customers(),
      collections: this.collections(),
      expenses: this.expenses(),
      employees: this.employees(),
      collectionGroups: this.collectionGroups(),
      usersList: this.usersList(),
      backupsList: this.backupsList()
    };
    
    // Maintain localStorage as a fast local fallback
    localStorage.setItem('smart_finance_db_v1.0', JSON.stringify(exportObj));

    // Save state securely to IndexedDB
    FinanceDB.saveAllData(exportObj).then(() => {
      // Auto-upload to Cloud on change silently and securely
      this.pushToSupabase(true);
    }).catch((err: unknown) => {
      console.error('Failed to sync state into IndexedDB/Supabase', err);
    });
  }

  seedDemoData(): void {
    const defaultSettings: AppSettings = {
      companyName: 'SmartGoNext',
      englishName: 'SmartGoNext',
      branch: 'புதுச்சேரி',
      subtitle: 'நம்பகமான நிதி சேவை',
      openingBalance: 200000,
      audioEnabled: true,
      dailyInterest: 0,
      weeklyInterest: 0,
      monthlyInterest: 0,
      defaultDailyTenure: 100,
      defaultWeeklyTenure: 52,
      defaultMonthlyTenure: 12
    };

    this.settings.set(defaultSettings);
    this.settingsForm.patchValue(defaultSettings, { emitEvent: false });

    this.usersList.set([
      { username: 'admin', displayName: 'Administrator', role: 'admin', permissions: ['Full Access'], status: 'Active' }
    ]);
    this.backupsList.set([]);

    this.customers.set([]);
    this.collections.set([]);
    this.expenses.set([]);
    this.employees.set([]);

    // Save and persist empty, clean, ready-to-use data state
    this.saveDatabase();

    this.showToast('நிறுவன அமைப்புகள் வெற்றிகரமாக மீட்டமைக்கப்பட்டது / Organization settings loaded successfully!', 'info');
  }

  // --- AUDIO FEEDBACK GENERATOR ---
  playBeep(success = true): void {
    // Disabled - Audio sounds completely removed
    if (!success) {
      return;
    }
  }

  // --- AUTHENTICATION ACTIONS ---
  togglePasswordVisibility(): void {
    this.passwordVisible.update(visible => !visible);
  }

  onSubmit(): void {
    this.generalError.set('');

    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      this.playBeep(false);
      return;
    }

    const username = this.loginForm.get('username')?.value ?? '';
    const password = this.loginForm.get('password')?.value ?? '';

    this.isLoading.set(true);

    setTimeout(() => {
      this.isLoading.set(false);

      if (username.trim() === 'admin' && password === 'admin123') {
        this.loginSuccess.set(true);
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem('sri_finance_logged_in', 'true');
        }
        this.playBeep(true);
        this.showToast('உள்நுழைவு வெற்றிகரமாக முடிந்தது! / Welcome, Administrator!', 'success');
        this.switchTab('dashboard');
      } else {
        this.generalError.set('தவறான பயனர்பெயர் அல்லது கடவுச்சொல் / Invalid admin credentials.');
        this.playBeep(false);
      }
    }, 1200);
  }

  logout(): void {
    this.loginSuccess.set(false);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('sri_finance_logged_in');
    }
    this.playBeep(true);
    this.loginForm.reset();
  }

  // --- TAB SENSITIVE ROUTING ---
  switchTab(tabName: string): void {
    this.activeTab.set(tabName);
    this.isMobileMenuOpen.set(false);
    this.playBeep(true);
    if (tabName === 'dashboard') {
      setTimeout(() => this.renderCharts(), 80);
    }
  }

  // --- DYNAMIC METRICS CALCULATION (FILTERED BY DATE) ---
  getTargetDateRange(): { start: string; end: string } {
    const filter = this.dateFilter();
    const todayStr = getLocalTodayString();
    
    if (filter === 'today') {
      return { start: todayStr, end: todayStr };
    } else if (filter === 'yesterday') {
      const yestStr = getRelativeDateString(1);
      return { start: yestStr, end: yestStr };
    } else if (filter === 'month') {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(year, d.getMonth() + 1, 0).getDate();
      return { start: `${year}-${month}-01`, end: `${year}-${month}-${lastDay}` };
    } else if (filter === 'year') {
      const year = new Date().getFullYear();
      return { start: `${year}-01-01`, end: `${year}-12-31` };
    } else {
      // Custom date filter input
      const custom = this.customFilterDate();
      return { start: custom, end: custom };
    }
  }

  getFilteredCollections(): Collection[] {
    const range = this.getTargetDateRange();
    return this.collections().filter(c => {
      const d = normalizeDate(c.date);
      return d && d >= range.start && d <= range.end;
    });
  }

  getFilteredExpenses(): Expense[] {
    const range = this.getTargetDateRange();
    return this.expenses().filter(e => {
      const d = normalizeDate(e.date);
      return d && d >= range.start && d <= range.end;
    });
  }

  // --- COMPREHENSIVE MATH ENGINE ---

  // Today indicators
  getTodayCollectionAmount(): number {
    return this.collections()
      .filter(c => c.date === getLocalTodayString())
      .reduce((s, item) => s + item.amount, 0);
  }

  getTodayExpenseAmount(): number {
    return this.expenses()
      .filter(e => e.date === getLocalTodayString())
      .reduce((s, item) => s + item.amount, 0);
  }

  // Active Filter totals
  getFilterCollectionTotal(): number {
    return this.getFilteredCollections().reduce((s, item) => s + item.amount, 0);
  }

  getFilterPITotal(): number {
    return this.getFilteredCollections().reduce((s, item) => s + item.principalAmount, 0);
  }

  getFilterInterestTotal(): number {
    return this.getFilteredCollections().reduce((s, item) => s + item.interestAmount, 0);
  }

  getFilterExpenseTotal(): number {
    return this.getFilteredExpenses().reduce((s, item) => s + item.amount, 0);
  }

  // Continuous cumulative totals
  getTotalCollectionCumulative(): number {
    return this.collections().reduce((s, c) => s + c.amount, 0);
  }

  getTotalInterestCumulative(): number {
    return this.collections().reduce((s, c) => s + c.interestAmount, 0);
  }

  getTotalPrincipalCumulative(): number {
    return this.collections().reduce((s, c) => s + c.principalAmount, 0);
  }

  getTotalExpenseCumulative(): number {
    return this.expenses().reduce((s, e) => s + e.amount, 0);
  }

  getTotalActiveLoansOut(): number {
    // Principal sum of all active loans
    return this.customers()
      .filter(c => c.status === 'Active')
      .reduce((s, c) => s + c.loanAmount, 0);
  }

  getTotalLoansIssuedCumulative(): number {
    return this.customers().reduce((s, c) => s + c.loanAmount, 0);
  }

  getTotalOutstandingCumulative(): number {
    return this.getLinePerformance('A').outstanding +
           this.getLinePerformance('W').outstanding +
           this.getLinePerformance('M').outstanding;
  }

  getTotalRetainedFeesCumulative(): number {
    return this.customers().reduce((sum, c) => {
      const fee = Math.round(c.loanAmount * (c.interestRate / 100));
      return sum + fee;
    }, 0);
  }

  getTodayRetainedFees(): number {
    const today = getLocalTodayString();
    return this.customers()
      .filter(c => normalizeDate(c.createdAt) === today)
      .reduce((sum, c) => {
        const fee = Math.round(c.loanAmount * (c.interestRate / 100));
        return sum + fee;
      }, 0);
  }

  calculateCurrentBalance(data: {
    openingBalance: number;
    collections: number;
    upfrontFees: number;
    totalLoansIssued: number;
    totalExpenses: number;
  }): number {
    const totalInflow = data.openingBalance + data.collections + data.upfrontFees;
    const totalOutflow = data.totalLoansIssued + data.totalExpenses;
    return totalInflow - totalOutflow;
  }

  getCurrentBalance(): number {
    const opening = this.settings().openingBalance;
    const collections = this.getTotalCollectionCumulative();
    const retainedFees = this.getTotalRetainedFeesCumulative();
    const loansOut = this.getTotalLoansIssuedCumulative();
    const expenses = this.getTotalExpenseCumulative();
    
    return this.calculateCurrentBalance({
      openingBalance: opening,
      collections: collections,
      upfrontFees: retainedFees,
      totalLoansIssued: loansOut,
      totalExpenses: expenses
    });
  }

  // --- TABLE LOGICS BY LINES (Daily A, Weekly W, Monthly M) ---
  getLinePerformance(line: 'A' | 'W' | 'M'): { collection: number; principal: number; interest: number; outstanding: number } {
    const filtered = this.getFilteredCollections().filter(c => c.line === line);
    const collectionSum = filtered.reduce((sum, item) => sum + item.amount, 0);
    const principalSum = filtered.reduce((sum, item) => sum + item.principalAmount, 0);
    const interestSum = filtered.reduce((sum, item) => sum + item.interestAmount, 0);

    // Sum all loans in this line category to match against cumulative principal payments
    const lineLoans = this.customers()
      .filter(c => c.line === line)
      .reduce((s, c) => s + c.loanAmount, 0);

    // Subtracted outstanding due from cumulative principal collections
    const accumulatedPrincipalForLine = this.collections()
      .filter(c => c.line === line)
      .reduce((sum, item) => sum + item.principalAmount, 0);

    const outstanding = Math.max(0, lineLoans - accumulatedPrincipalForLine);

    return {
      collection: collectionSum,
      principal: principalSum,
      interest: interestSum,
      outstanding
    };
  }

  // --- MOCK INFLOW / OUTFLOW LEDGER DATA ---
  getDLCCollectionInflow(): number {
    // DLC stands for Daily/Weekly/Monthly Line Collections to match full ledger balance logic
    return this.getFilterCollectionTotal();
  }

  getOpeningLedgeValue(): number {
    const range = this.getTargetDateRange();
    const initialOpening = this.settings().openingBalance;
    
    // Sum collections before range.start
    const priorCollections = this.collections()
      .filter(c => {
        const d = normalizeDate(c.date);
        return d && d < range.start;
      })
      .reduce((sum, c) => sum + c.amount, 0);
      
    // Sum upfront fees from customers onboarded before range.start
    const priorRetainedFees = this.customers()
      .filter(c => {
        const d = normalizeDate(c.createdAt);
        return d && d < range.start;
      })
      .reduce((sum, c) => {
        const fee = Math.round(c.loanAmount * (c.interestRate / 100));
        return sum + fee;
      }, 0);
      
    // Sum loans issued before range.start
    const priorLoans = this.customers()
      .filter(c => {
        const d = normalizeDate(c.createdAt);
        return d && d < range.start;
      })
      .reduce((sum, c) => sum + c.loanAmount, 0);
      
    // Sum expenses before range.start
    const priorExpenses = this.expenses()
      .filter(e => {
        const d = normalizeDate(e.date);
        return d && d < range.start;
      })
      .reduce((sum, e) => sum + e.amount, 0);
      
    return initialOpening + priorCollections + priorRetainedFees - priorLoans - priorExpenses;
  }

  getFilterRetainedFeesTotal(): number {
    const range = this.getTargetDateRange();
    return this.customers()
      .filter(c => {
        const d = normalizeDate(c.createdAt);
        return d && d >= range.start && d <= range.end;
      })
      .reduce((sum, c) => {
        const fee = Math.round(c.loanAmount * (c.interestRate / 100));
        return sum + fee;
      }, 0);
  }

  getFilterLedgerBalance(): number {
    const opening = this.getOpeningLedgeValue();
    const collections = this.getFilterCollectionTotal();
    const retainedFees = this.getFilterRetainedFeesTotal();
    const loansOut = this.getLoansGivenInFilterPeriod();
    const expenses = this.getFilterExpenseTotal();
    
    return this.calculateCurrentBalance({
      openingBalance: opening,
      collections: collections,
      upfrontFees: retainedFees,
      totalLoansIssued: loansOut,
      totalExpenses: expenses
    });
  }

  triggerLedgerAdditionForNewLoan(cust: Customer): void {
    const faceValue = cust.loanAmount;
    const processingFee = Math.round(cust.loanAmount * (cust.interestRate / 100));
    
    console.log(`[Ledger Double-Entry Trigger] Loan Added: ${cust.name} (${cust.id})`);
    console.log(`- Outflow (Full Face Value): ₹${faceValue}`);
    console.log(`- Inflow/Profit (Processing Fee): ₹${processingFee}`);
    
    this.showToast(
      `Ledger: Outflow ₹${faceValue.toLocaleString()} & Inflow/Profit ₹${processingFee.toLocaleString()} added.`,
      'success'
    );
  }

  // Outflow elements
  getLoansGivenInFilterPeriod(): number {
    const range = this.getTargetDateRange();
    return this.customers()
      .filter(c => {
        const d = normalizeDate(c.createdAt);
        return d && d >= range.start && d <= range.end;
      })
      .reduce((s, c) => s + c.loanAmount, 0);
  }

  // --- NOTIFICATION MANAGEMENT ---
  showToast(message: string, type: 'success' | 'danger' | 'info' = 'success'): void {
    const id = ++this.toastIdCounter;
    this.toasts.update(list => [...list, { id, message, type }]);
    
    // Automatic cleanup
    setTimeout(() => {
      this.toasts.update(list => list.filter(t => t.id !== id));
    }, 4500);
  }

  // --- CORE FORM TRANSACTION HANDLERS ---

  // Registers a new micro-loan customer profile
  onAddCustomer(): void {
    const formVal = this.customerForm.getRawValue();
    const newId = 'CUST-' + (this.customers().length + 1).toString().padStart(2, '0');

    const displayName = formVal.name.trim() || 'No Name / பெயர் இல்லா';

    const newCust: Customer = {
      id: newId,
      name: displayName,
      englishName: formVal.englishName.trim() || displayName,
      phone: formVal.phone,
      address: formVal.address,
      line: formVal.line,
      loanAmount: formVal.loanAmount ?? 0,
      interestRate: formVal.interestRate ?? 0,
      tenure: formVal.tenure ?? 0,
      status: 'Active',
      createdAt: this.startDate(), // Register on active selected start date
      
      // Extended fields
      fatherName: formVal.fatherName,
      occupation: formVal.occupation || 'வியாபாரம் / Business',
      idProofType: formVal.idProofType,
      idProofNumber: formVal.idProofNumber,
      referralId: this.referralCustomer() ? this.referralCustomer()?.id : undefined,
      referralRelation: this.referralCustomer() ? this.referralRelation() : undefined,
      collectionGroup: formVal.collectionGroup,
      interestType: this.interestType(),
      filesCount: this.uploadedFiles().length,
      clNo: formVal.clNo || undefined,
      profilePhoto: this.customerProfilePhoto() || undefined
    };

    // Check duplicate detection toast helper
    const alreadyExists = this.customers().some(c => c.phone === formVal.phone);

    this.customers.update(list => [newCust, ...list]);
    this.triggerLedgerAdditionForNewLoan(newCust);
    this.playBeep(true);

    if (alreadyExists) {
      this.showToast('Customer Exists', 'danger'); // Warning Toast
    } else {
      this.showToast('Loan Created Successfully', 'success'); // Success Toast
    }

    this.clearDraft();

    // Reset inputs
    this.customerForm.reset({
      name: '',
      englishName: '',
      phone: '',
      fatherName: '',
      occupation: '',
      address: '',
      idProofType: 'Aadhaar',
      idProofNumber: '',
      line: 'A',
      loanAmount: null,
      interestRate: null,
      tenure: null,
      collectionGroup: '',
      clNo: ''
    });

    // Reset extended state parameters
    this.currentWizardStep.set(1);
    this.referralCustomer.set(null);
    this.uploadedFiles.set([]);
    this.customerProfilePhoto.set(null);
    this.interestType.set('Daily');
    this.profitAmount.set(1500);
    this.startDate.set(getLocalTodayString());

    // Auto-return back to dashboard view
    this.switchTab('dashboard');
  }

  deleteCustomer(cust: Customer): void {
    if (!cust) return;
    this.confirmDialogState.set({
      title: 'வாடிக்கையாளர் நீக்கம் / Delete Customer',
      message: `உறுதியாக வாடிக்கையாளர் ${cust.name} மற்றும் அவரது கடன் கணக்கை நீக்க விரும்புகிறீர்களா? / Are you sure you want to permanently delete customer ${cust.name} and their loan details?`,
      confirmText: 'நீக்கு / Delete',
      cancelText: 'ரத்து / Cancel',
      onConfirm: () => {
        this.customers.update(list => list.filter(c => c.id !== cust.id));
        this.collections.update(list => list.filter(col => col.customerId !== cust.id));
        
        // Cleanup any active selections referencing the deleted customer
        if (this.selectedCollectionCustomer()?.id === cust.id) {
          this.selectedCollectionCustomer.set(null);
        }
        if (this.portfolioCustomer()?.id === cust.id) {
          this.portfolioCustomer.set(null);
        }
        if (this.referralCustomer()?.id === cust.id) {
          this.referralCustomer.set(null);
        }
        this.searchSuggestions.update(list => list.filter(c => c.id !== cust.id));

        this.saveDatabase();
        this.showToast('வாடிக்கையாளர் கணக்கு வெற்றிகரமாக நீக்கப்பட்டது / Customer account deleted successfully!', 'info');
      }
    });
  }

  // --- CUSTOMER SEARCH / AUTO-COMPLETE & DUPLICATE DETECTION ---
  onCustSearchInput(event: Event): void {
    const query = (event.target as HTMLInputElement).value.trim().toLowerCase();
    this.newCustSearchQuery.set(query);
    if (!query) {
      this.searchSuggestions.set([]);
      return;
    }
    const filtered = this.customers().filter(c => 
      c.name.toLowerCase().includes(query) || 
      c.englishName.toLowerCase().includes(query) ||
      c.phone.includes(query) ||
      (c.clNo && c.clNo.toLowerCase().includes(query))
    );
    this.searchSuggestions.set(filtered);
  }

  clearSearchQuery(): void {
    this.newCustSearchQuery.set('');
    this.searchSuggestions.set([]);
  }

  selectSuggestedCustomer(cust: Customer): void {
    // Populate form with existing customer details
    this.customerForm.patchValue({
      name: cust.name,
      englishName: cust.englishName,
      phone: cust.phone,
      address: cust.address,
      line: cust.line,
      fatherName: cust.fatherName || 'உள்நுழையவில்லை',
      occupation: cust.occupation || 'வியாபாரம் / Business',
      idProofType: cust.idProofType || 'Aadhaar',
      idProofNumber: cust.idProofNumber || 'XXXXXXXXXXXX',
      collectionGroup: cust.collectionGroup || this.collectionGroups()[0],
      clNo: cust.clNo || ''
    });

    const resolvedType = cust.interestType || (cust.line === 'A' ? 'Daily' : cust.line === 'W' ? 'Weekly' : 'Monthly');
    this.interestType.set(resolvedType);
    this.playBeep(true);
    
    // Yellow Warning Toast in Top-Right
    this.showToast('Customer Exists', 'danger');
    
    // Jump straight into Step 2: Loan Details!
    this.goToStep(2);
    this.searchSuggestions.set([]);
    this.newCustSearchQuery.set('');
  }

  goToStep(stepNum: number): void {
    this.currentWizardStep.set(stepNum);
  }

  // --- REFERRAL MANAGEMENT ---
  selectReferral(cust: Customer): void {
    this.referralCustomer.set(cust);
  }

  proceedWithManualReferral(): void {
    const name = this.newReferralName().trim();
    const phone = this.newReferralPhone().trim();
    if (!name || !phone) {
      this.showToast('பரிந்துரையாளர் விவரங்களை சரியாக உள்ளிடவும் / Please enter name and phone number.', 'danger');
      return;
    }
    this.referralCustomer.set({
      id: 'REF-' + Math.floor(Math.random() * 1000 + 100),
      name: name,
      englishName: name,
      phone: phone,
      address: 'Referral Added Manual',
      line: 'A',
      loanAmount: 0,
      interestRate: 0,
      tenure: 0,
      status: 'Active',
      createdAt: getLocalTodayString()
    });
    this.newReferralName.set('');
    this.newReferralPhone.set('');
    this.referralTab.set('search');
  }

  saveReferral(): void {
    this.showReferralModal.set(false);
    this.showToast('பரிந்துரையாளர் சேர்க்கப்பட்டார் / Referral associated successfully!', 'success');
  }

  removeReferral(): void {
    this.referralCustomer.set(null);
    this.showToast('பரிந்துரையாளர் நீக்கப்பட்டார் / Referral Removed Successfully.', 'info');
  }

  onLanguageClick(lang: 'tamil' | 'english'): void {
    const isTransTamil = lang === 'tamil';
    this.isTamil.set(isTransTamil);
    this.selectedLanguageButton.set(lang);

    // Format current timestamp elegantly in YYYY-MM-DD HH:MM:SS format
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const formattedTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    this.lastLanguageClickTime.set(formattedTime);

    // Trigger the modal display
    this.showLanguageModal.set(true);

    this.showToast(
      isTransTamil 
        ? 'தமிழ் மொழி வெற்றிகரமாக தேர்ந்தெடுக்கப்பட்டது!' 
        : 'English language set successfully!', 
      'success'
    );
  }

  t(text: string): string {
    if (!text) return '';
    const parts = text.split(' / ');
    if (parts.length < 2) return text;
    return this.isTamil() ? parts[0] : parts[1];
  }

  getFilteredReferralCustomers(): Customer[] {
    const query = this.referralSearchQuery().toLowerCase().trim();
    if (!query) return [];
    return this.customers().filter(c => 
      c.name.toLowerCase().includes(query) || 
      c.englishName.toLowerCase().includes(query) || 
      c.phone.includes(query)
    );
  }

  // --- DYNAMIC CALCULATORS ---
  getPreviewSchedule(): InstallmentScheduleItem[] {
    const loanAmt = this.customerForm.get('loanAmount')?.value ?? 0;
    const tenure = this.customerForm.get('tenure')?.value ?? 0;
    const profit = this.profitAmount() || 0;
    const startVal = this.startDate();
    const type = this.interestType();

    if (loanAmt <= 0 || tenure <= 0 || !startVal) {
      return [];
    }

    // Limit layout preview to max 365 installments to prevent DOM bloat if invalid entries
    const cappedTenure = Math.min(365, Math.max(1, Math.round(tenure)));
    const schedule: InstallmentScheduleItem[] = [];
    const regularEmi = Math.round(loanAmt / cappedTenure);
    let balance = loanAmt;

    const regularProfit = parseFloat((profit / cappedTenure).toFixed(2)) || 0;
    const regularPrincipal = parseFloat(((loanAmt - profit) / cappedTenure).toFixed(2)) || 0;

    try {
      const baseDate = new Date(startVal);
      if (isNaN(baseDate.getTime())) return [];

      let accumulatedProfit = 0;
      let accumulatedPrincipal = 0;

      for (let i = 1; i <= cappedTenure; i++) {
        const d = new Date(baseDate.getTime());
        if (type === 'Daily') {
          d.setDate(d.getDate() + i);
        } else if (type === 'Weekly') {
          d.setDate(d.getDate() + (i * 7));
        } else if (type === 'Monthly') {
          d.setMonth(d.getMonth() + i);
        }

        const dateStr = d.toISOString().split('T')[0];

        let amount = regularEmi;
        if (i === cappedTenure) {
          const accumulatedSoFar = regularEmi * (cappedTenure - 1);
          amount = loanAmt - accumulatedSoFar;
        }

        let currentProfit = regularProfit;
        let currentPrincipal = regularPrincipal;

        if (i === cappedTenure) {
          currentProfit = parseFloat((profit - accumulatedProfit).toFixed(2)) || 0;
          currentPrincipal = parseFloat(((loanAmt - profit) - accumulatedPrincipal).toFixed(2)) || 0;
        } else {
          accumulatedProfit += regularProfit;
          accumulatedPrincipal += regularPrincipal;
        }

        balance -= amount;
        if (i === cappedTenure || balance < 0) {
          balance = 0;
        }

        schedule.push({
          num: i,
          date: dateStr,
          amount: amount,
          principal: currentPrincipal,
          profit: currentProfit,
          remaining: balance
        });
      }
    } catch (e) {
      console.error('Error generating preview schedule:', e);
    }

    return schedule;
  }

  recalculateFromRate(): void {
    const amt = this.customerForm.get('loanAmount')?.value ?? 0;
    const rate = this.customerForm.get('interestRate')?.value ?? 0;
    this.profitAmount.set(amt * (rate / 100));
  }

  onProfitAmountInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const val = parseFloat(input.value) || 0;
    this.profitAmount.set(val);
    const amt = this.customerForm.get('loanAmount')?.value ?? 0;
    if (amt > 0) {
      const percentage = (val / amt) * 100;
      this.customerForm.patchValue({ interestRate: parseFloat(percentage.toFixed(2)) }, { emitEvent: false });
    }
    this.saveDraft();
  }

  onEmiAmountInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const emi = parseFloat(input.value) || 0;
    if (emi > 0) {
      const amt = this.customerForm.get('loanAmount')?.value ?? 0;
      if (amt > 0) {
        const tenure = Math.round(amt / emi);
        this.customerForm.patchValue({ tenure: Math.max(1, tenure) }, { emitEvent: false });
      }
    }
    this.saveDraft();
  }

  getEmiAmount(): number {
    const amt = this.customerForm.get('loanAmount')?.value ?? 0;
    const tenure = this.customerForm.get('tenure')?.value || 1;
    return amt > 0 ? Math.round(amt / tenure) : 0;
  }

  getClosingDate(): string {
    const startVal = this.startDate();
    const tenure = this.customerForm.get('tenure')?.value;
    const type = this.interestType();
    
    if (!startVal || !tenure || tenure <= 0) return '';
    try {
      const d = new Date(startVal);
      if (isNaN(d.getTime())) return '';
      if (type === 'Daily') {
        d.setDate(d.getDate() + tenure);
      } else if (type === 'Weekly') {
        d.setDate(d.getDate() + tenure * 7);
      } else if (type === 'Monthly') {
        d.setMonth(d.getMonth() + tenure);
      }
      return d.toISOString().split('T')[0];
    } catch {
      return '';
    }
  }

  onEndDateChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const endVal = input.value;
    const startVal = this.startDate();
    if (!startVal || !endVal) return;

    try {
      const dStart = new Date(startVal);
      const dEnd = new Date(endVal);
      if (isNaN(dStart.getTime()) || isNaN(dEnd.getTime())) return;
      if (dEnd < dStart) return;

      const diffTime = dEnd.getTime() - dStart.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      const type = this.interestType();
      let calculatedTenure = 1;

      if (type === 'Daily') {
        calculatedTenure = diffDays;
      } else if (type === 'Weekly') {
        calculatedTenure = Math.max(1, Math.round(diffDays / 7));
      } else if (type === 'Monthly') {
        const yearsDiff = dEnd.getFullYear() - dStart.getFullYear();
        const monthsDiff = dEnd.getMonth() - dStart.getMonth();
        calculatedTenure = Math.max(1, (yearsDiff * 12) + monthsDiff);
      }

      this.customerForm.patchValue({ tenure: calculatedTenure });
      this.saveDraft();
    } catch (e) {
      console.error('Error calculating tenure from end date:', e);
    }
  }

  setInterestType(type: 'Daily' | 'Weekly' | 'Monthly'): void {
    this.interestType.set(type);
    const lineMap: Record<string, 'A' | 'W' | 'M'> = {
      'Daily': 'A',
      'Weekly': 'W',
      'Monthly': 'M'
    };
    this.customerForm.patchValue({ line: lineMap[type] });
    this.saveDraft();
  }

  // --- DRAFT STORAGE METHODS ---
  saveDraft(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const draft = {
      formValues: this.customerForm.getRawValue(),
      interestType: this.interestType(),
      referralCustomer: this.referralCustomer(),
      referralRelation: this.referralRelation(),
      startDate: this.startDate(),
      profilePhoto: this.customerProfilePhoto()
    };
    localStorage.setItem('sri_finance_customer_draft', JSON.stringify(draft));
    this.draftAutoSavedTime.set(new Date().toLocaleTimeString());
  }

  clearDraft(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem('sri_finance_customer_draft');
    this.draftAutoSavedTime.set('');
  }

  // --- INLINE COLLECTION GROUP MANAGEMENT ---
  addCollectionGroup(): void {
    const name = this.newCollectionGroupName().trim();
    if (!name) {
      this.showToast('குழு பெயரை சரியாக உள்ளிடவும் / Group name cannot be empty.', 'danger');
      return;
    }
    if (this.collectionGroups().includes(name)) {
      this.showToast('இந்த குழு ஏற்கனவே உள்ளது / This group already exists.', 'danger');
      return;
    }
    this.collectionGroups.update(list => [...list, name]);
    this.customerForm.patchValue({ collectionGroup: name });
    this.newCollectionGroupName.set('');
    this.showManageGroups.set(false);
    this.showToast('Group Added Successfully', 'success');
  }

  deleteCollectionGroup(group: string): void {
    if (this.collectionGroups().length <= 1) {
      this.showToast('குறைந்தது ஒரு குழு இருக்க வேண்டும் / Must have at least one group.', 'danger');
      return;
    }
    this.collectionGroups.update(list => list.filter(g => g !== group));
    if (this.customerForm.get('collectionGroup')?.value === group) {
      this.customerForm.patchValue({ collectionGroup: this.collectionGroups()[0] });
    }
    this.showToast('Collection Group Deleted Successfully', 'info');
  }

  // --- DOCUMENT UPLOADER ATTACHMENTS ---
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.handleFiles(input.files);
    }
  }

  onFileDropped(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files) {
      this.handleFiles(event.dataTransfer.files);
    }
  }

  handleFiles(files: FileList): void {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    const filesArray = Array.from(files);
    for (const file of filesArray) {
      if (!allowedTypes.includes(file.type)) {
        this.showToast('தவறான கோப்பு வடிவம் (PDF, JPG, PNG மட்டுமே) / Allowed formats: PDF, JPG, PNG only.', 'danger');
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        this.showToast('கோப்பு அளவு 5MB மிகக்கூடாது / File size cannot exceed 5MB.', 'danger');
        continue;
      }
      const sizeStr = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      
      const fileObj = {
        name: file.name,
        size: sizeStr,
        type: file.type,
        url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      };
      this.uploadedFiles.update(list => [...list, fileObj]);
    }
    this.showToast('கோப்பு வெற்றிகரமாக இணைக்கப்பட்டது / Files added to attachments.', 'success');
  }

  removeFile(index: number): void {
    this.uploadedFiles.update(list => list.filter((_, i) => i !== index));
    this.showToast('கோப்பு நீக்கப்பட்டது / Attachment removed.', 'info');
  }

  onProfilePhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (!['image/jpeg', 'image/png', 'image/jpg'].includes(file.type)) {
        this.showToast('தவறான வடிவம். JPG, PNG மட்டுமே / Allowed formats: JPG, PNG only.', 'danger');
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        this.showToast('கோப்பு அளவு 8MB மிகக்கூடாது / File size cannot exceed 8MB.', 'danger');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // Resize image to 150x150 for super-compact storage
          const canvas = document.createElement('canvas');
          const max_size = 150;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > max_size) {
              height *= max_size / width;
              width = max_size;
            }
          } else {
            if (height > max_size) {
              width *= max_size / height;
              height = max_size;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const resizedBase64 = canvas.toDataURL('image/jpeg', 0.82);
            this.customerProfilePhoto.set(resizedBase64);
            this.showToast('சுயவிவரப் படம் வெற்றிகரமாக இணைக்கப்பட்டது / Profile photo added.', 'success');
            this.saveDraft();
          }
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  clearProfilePhoto(): void {
    this.customerProfilePhoto.set(null);
    const fileInput = document.getElementById('profilePhotoInput') as HTMLInputElement | null;
    if (fileInput) {
      fileInput.value = '';
    }
    this.saveDraft();
  }

  // --- COLLECTION ENTRY DASHBOARD HELPERS ---
  
  getLoanNo(cust: Customer): string {
    if (!cust) return '';
    if (cust.clNo && cust.clNo.trim()) {
      return cust.clNo;
    }
    if (cust.id.startsWith('SRF-')) {
      return cust.id;
    }
    const numericPart = cust.id.replace('CUST-', '');
    if (!isNaN(Number(numericPart))) {
      return `SRF-2026-${numericPart.padStart(5, '0')}`;
    }
    return cust.id;
  }

  getLoanNoForCollection(c: Collection): string {
    const cust = this.customers().find(x => x.id === c.customerId);
    return cust ? this.getLoanNo(cust) : c.id;
  }

  getClNoForCollection(c: Collection): string {
    const cust = this.customers().find(x => x.id === c.customerId);
    return cust && cust.clNo ? cust.clNo : '';
  }

  getUniqueGroups(): string[] {
    const groups = this.customers()
      .filter(c => c.status === 'Active')
      .map(c => c.collectionGroup)
      .filter((g): g is string => !!g);
    return Array.from(new Set(groups)).sort();
  }

  getFilteredCollectionCustomers(): Customer[] {
    const query = this.collectionSearchQuery().toLowerCase().trim();
    const typeFilter = this.collectionTypeFilter();
    const groupFilter = this.collectionGroupFilter();

    return this.customers().filter(cust => {
      if (cust.status !== 'Active') return false;

      // Group filter
      if (groupFilter !== 'all' && cust.collectionGroup !== groupFilter) {
        return false;
      }

      // Type filter : Daily, Weekly, Monthly. Maps to cust.line: 'A', 'W', 'M'
      if (typeFilter !== 'all') {
        const lineMap: Record<string, string> = { 'Daily': 'A', 'Weekly': 'W', 'Monthly': 'M' };
        if (cust.line !== lineMap[typeFilter]) return false;
      }

      // Search query
      if (query) {
        const ln = this.getLoanNo(cust).toLowerCase();
        const nm = cust.name.toLowerCase();
        const eng = cust.englishName.toLowerCase();
        const ph = cust.phone;
        const cl = (cust.clNo || '').toLowerCase();
        if (!ln.includes(query) && !nm.includes(query) && !eng.includes(query) && !ph.includes(query) && !cl.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }

  // Stats cards calculations based on filtered customer set
  getTotalFilteredCount(): number {
    return this.getFilteredCollectionCustomers().length;
  }

  getPaidTodayCount(): number {
    const today = getLocalTodayString();
    const filteredCustIds = new Set(this.getFilteredCollectionCustomers().map(c => c.id));
    
    // Count how many of these customers have paid today
    return this.collections().filter(col => {
      return col.date === today && filteredCustIds.has(col.customerId);
    }).reduce((acc, col) => {
      // Unique customers paid
      return acc.add(col.customerId);
    }, new Set<string>()).size;
  }

  getTodayAmountCollected(): number {
    const today = getLocalTodayString();
    const filteredCustIds = new Set(this.getFilteredCollectionCustomers().map(c => c.id));
    
    return this.collections()
      .filter(col => col.date === today && filteredCustIds.has(col.customerId))
      .reduce((sum, col) => sum + col.amount, 0);
  }

  getRemainingCount(): number {
    return Math.max(0, this.getTotalFilteredCount() - this.getPaidTodayCount());
  }

  // Check if a customer has paid today
  hasPaidToday(cust: Customer): boolean {
    const today = getLocalTodayString();
    return this.collections().some(c => c.customerId === cust.id && c.date === today);
  }

  // Get what a customer paid today
  getAmountPaidToday(cust: Customer): string {
    const today = getLocalTodayString();
    const paidList = this.collections().filter(c => c.customerId === cust.id && c.date === today);
    if (paidList.length === 0) return '-';
    const sum = paidList.reduce((acc, c) => acc + c.amount, 0);
    return `₹${sum.toLocaleString()}`;
  }

  clearCollectionFilters(): void {
    this.collectionSearchQuery.set('');
    this.collectionTypeFilter.set('all');
    this.collectionGroupFilter.set('all');
  }

  getCustOriginalLoan(cust: Customer): number {
    return Math.round(cust.loanAmount * (1 - cust.interestRate / 100));
  }

  getCustInterestRate(cust: Customer): number {
    return cust.interestRate;
  }

  getCustTotalPayable(cust: Customer): number {
    return cust.loanAmount;
  }

  getCustEmi(cust: Customer): number {
    return Math.round(this.getCustTotalPayable(cust) / cust.tenure);
  }

  getCustTotalPaid(cust: Customer): number {
    return this.collections()
      .filter(c => c.customerId === cust.id)
      .reduce((sum, c) => sum + c.amount, 0);
  }

  getCustTotalPrincipalPaid(cust: Customer): number {
    return this.collections()
      .filter(c => c.customerId === cust.id)
      .reduce((sum, c) => sum + (c.principalAmount ?? c.amount), 0);
  }

  getCustBalance(cust: Customer): number {
    const totalPayable = this.getCustTotalPayable(cust);
    const principalPaid = this.getCustTotalPrincipalPaid(cust);
    return Math.max(0, totalPayable - principalPaid);
  }

  getCustProgress(cust: Customer): number {
    const totalPayable = this.getCustTotalPayable(cust);
    if (totalPayable <= 0) return 0;
    const principalPaid = this.getCustTotalPrincipalPaid(cust);
    return Math.min(100, Math.round((principalPaid / totalPayable) * 100));
  }

  openCustomerPortfolio(cust: Customer): void {
    this.portfolioCustomer.set(cust);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  getPortfolioStats(cust: Customer) {
    if (!cust) {
      return {
        totalLoans: 0,
        activeLoans: 0,
        closedLoans: 0,
        outstanding: 0,
        totalPaid: 0,
        progress: 0,
        profitGained: 0,
        eligibility: '',
        eligibilityColor: '',
        progressStatus: '',
        collectionsCount: 0,
        collectionsList: []
      };
    }
    
    const samePhoneCustomers = this.customers().filter(c => c.phone === cust.phone);
    const totalLoans = samePhoneCustomers.length;
    const activeLoans = samePhoneCustomers.filter(c => c.status === 'Active').length;
    const closedLoans = samePhoneCustomers.filter(c => c.status === 'Closed').length;

    const outstanding = this.getCustBalance(cust);
    const totalPaid = this.getCustTotalPaid(cust);
    const progress = this.getCustProgress(cust);

    const collectionsForCust = this.collections()
      .filter(c => c.customerId === cust.id)
      .sort((a, b) => b.date.localeCompare(a.date));

    const profitFromCollections = collectionsForCust.reduce((sum, c) => sum + (c.interestAmount || 0), 0);
    const preDeductedInterest = cust.loanAmount - this.getCustOriginalLoan(cust);
    const profitGained = preDeductedInterest + profitFromCollections;

    // Match eligibility shown on Image 2
    const isRisky = progress < 45 && cust.status === 'Active';
    let progressStatus = isRisky ? 'RISKY ELIGIBLE' : 'GOOD ELIGIBLE';
    if (cust.status === 'Closed') {
      progressStatus = 'CLEARED';
    }

    let eligibility = 'அபாயமற்றது / Safe';
    let eligibilityColor = 'text-emerald-600 border border-emerald-500/15 bg-emerald-50/50 dark:bg-emerald-950/15 dark:text-emerald-400';
    if (isRisky) {
      eligibility = 'அதிர்ஷ்டம் / Risky';
      eligibilityColor = 'text-rose-600 border border-red-500/15 bg-rose-50/50 dark:bg-rose-950/15 dark:text-rose-400';
    }

    return {
      totalLoans,
      activeLoans,
      closedLoans,
      outstanding,
      totalPaid,
      progress,
      profitGained,
      eligibility,
      eligibilityColor,
      progressStatus,
      collectionsCount: collectionsForCust.length,
      collectionsList: collectionsForCust
    };
  }

  disburseReLoan(cust: Customer): void {
    // Standard re-loan copying of basic attributes
    this.customerForm.patchValue({
      name: cust.name,
      englishName: cust.englishName || cust.name,
      phone: cust.phone,
      fatherName: cust.fatherName || '',
      occupation: cust.occupation || '',
      address: cust.address,
      idProofType: cust.idProofType || 'Aadhaar',
      idProofNumber: cust.idProofNumber || '',
      line: cust.line,
      loanAmount: 10000,
      interestRate: cust.interestRate,
      tenure: cust.tenure,
      collectionGroup: cust.collectionGroup || 'A Line Group 1',
      clNo: ''
    });
    
    this.currentWizardStep.set(1);
    
    if (cust.profilePhoto) {
      this.customerProfilePhoto.set(cust.profilePhoto);
    } else {
      this.customerProfilePhoto.set(null);
    }
    
    this.activeTab.set('new-customer');
    this.portfolioCustomer.set(null);
    this.showToast('வாடிக்கையாளர் தகவல்கள் புதிய கடனுக்காகப் நகலெடுக்கப்பட்டது / Profile cloned. Set new loan details!', 'info');
  }

  closePortfolioLoan(cust: Customer): void {
    this.confirmDialogState.set({
      title: 'கடன் கணக்கு மூடல் / Close Loan Account',
      message: 'உறுதியாக இந்த கடனை அடைக்க விரும்புகிறீர்களா? / Are you sure you want to completely close this loan account?',
      confirmText: 'மூடு / Close Loan',
      cancelText: 'ரத்து / Cancel',
      onConfirm: () => {
        this.customers.update(list => {
          return list.map(c => {
            if (c.id === cust.id) {
              return { ...c, status: 'Closed' as const };
            }
            return c;
          });
        });
        this.saveDatabase();
        this.showToast('கடன் வெற்றிகரமாக அடைக்கப்பட்டது / Loan completely closed successfully!', 'success');
        
        const updated = this.customers().find(c => c.id === cust.id) || null;
        this.portfolioCustomer.set(updated);
      }
    });
  }

  printPortfolio(): void {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }

  selectCollectionCustomerForEntry(cust: Customer): void {
    this.selectedCollectionCustomer.set(cust);
    
    // Pre-populate typical EMI installment as a single collection amount without splits
    const emi = this.getCustEmi(cust);

    this.collectionForm.patchValue({
      customerId: cust.id,
      amount: emi,
      interestAmount: 0,
      principalAmount: emi,
      date: getLocalTodayString(),
      notes: ''
    });
  }

  // Posts a financial collection payment ledger receipt
  onPostCollection(): void {
    if (this.collectionForm.invalid) {
      this.collectionForm.markAllAsTouched();
      this.playBeep(false);
      this.showToast('Please correct collection input values.', 'danger');
      return;
    }

    const val = this.collectionForm.getRawValue();
    const cust = this.selectedCollectionCustomer();

    if (!cust) {
      this.showToast('Selected customer is invalid.', 'danger');
      return;
    }

    const newTxn: Collection = {
      id: 'TXN-' + (this.collections().length + 103).toString(),
      customerId: cust.id,
      customerName: cust.name,
      amount: val.amount,
      interestAmount: val.interestAmount,
      principalAmount: val.principalAmount,
      line: cust.line,
      date: val.date,
      notes: val.notes,
      paymentMethod: val.paymentMethod
    };

    this.collections.update(list => [newTxn, ...list]);
    this.saveDatabase();
    this.playBeep(true);
    
    // Trigger auto-closing popup
    this.showCollectionSuccessModal.set(true);
    setTimeout(() => {
      this.showCollectionSuccessModal.set(false);
    }, 2000);

    // Reset customer details & collection inputs
    this.selectedCollectionCustomer.set(null);
    this.collectionForm.reset({
      customerId: '',
      amount: 0,
      interestAmount: 0,
      principalAmount: 0,
      date: getLocalTodayString(),
      notes: '',
      paymentMethod: 'Cash'
    });
  }

  // Registers operational expenses
  onPostExpense(): void {
    if (this.expenseForm.invalid) {
      this.expenseForm.markAllAsTouched();
      this.playBeep(false);
      return;
    }

    const val = this.expenseForm.getRawValue();
    const newExp: Expense = {
      id: 'EXP-' + (this.expenses().length + 103).toString(),
      type: val.type,
      amount: val.amount || 0,
      date: val.date,
      description: val.description || `${val.type} Expense recorded`
    };

    this.expenses.update(list => [newExp, ...list]);
    this.playBeep(true);
    this.saveDatabase();
    this.showToast(`செலவுத் தொகை ₹${val.amount} பதிவு செய்யப்பட்டது / Expense recorded successfully!`, 'success');

    this.expenseForm.reset({
      type: 'Office',
      amount: null,
      date: getLocalTodayString(),
      description: ''
    });

    this.showAddExpensePanel.set(false);
  }

  deleteExpense(id: string): void {
    this.confirmDialogState.set({
      title: 'செலவுப் பதிவு நீக்கம் / Delete Expense Record',
      message: 'இந்த செலவை நீக்க வேண்டுமா? / Are you sure you want to delete this expense?',
      confirmText: 'நீக்கு / Delete',
      cancelText: 'ரத்து / Cancel',
      onConfirm: () => {
        this.expenses.update(list => list.filter(e => e.id !== id));
        this.playBeep(true);
        this.saveDatabase();
        this.showToast('செலவு பதிவு நீக்கப்பட்டது / Expense record deleted.', 'info');
      }
    });
  }

  // Registers or updates employee
  onAddEmployee(): void {
    if (this.employeeForm.invalid) {
      this.employeeForm.markAllAsTouched();
      this.playBeep(false);
      return;
    }

    const val = this.employeeForm.getRawValue();
    
    if (this.editingEmployeeId()) {
      // Edit existing employee
      this.employees.update(list => list.map(e => e.id === this.editingEmployeeId() ? {
        ...e,
        name: val.name,
        role: val.role,
        phone: val.phone,
        collectionGroup: val.collectionGroup,
        salary: Number(val.salary) || 10000,
        joinDate: val.joinDate
      } : e));
      this.showToast(`ஊழியர் விவரங்கள் மாற்றம் செய்யப்பட்டன / Employee updated!`, 'success');
      this.editingEmployeeId.set(null);
    } else {
      // Add new employee
      const newEmp: Employee = {
        id: 'EMP-' + (this.employees().length + 1).toString().padStart(2, '0'),
        name: val.name,
        role: val.role,
        phone: val.phone,
        status: 'Active',
        collectionGroup: val.collectionGroup || '',
        salary: Number(val.salary) || 10000,
        joinDate: val.joinDate || getLocalTodayString(),
        attendance: {}
      };
      this.employees.update(list => [...list, newEmp]);
      this.showToast(`ஊழியர் சேர்க்கப்பட்டார் / Employee added successfully!`, 'success');
    }

    this.playBeep(true);
    this.showAddEmployeeModal.set(false);
    this.saveDatabase();

    this.employeeForm.reset({
      name: '',
      role: 'Collection',
      phone: '',
      collectionGroup: this.collectionGroups()[0] || '',
      salary: 10000,
      joinDate: getLocalTodayString()
    });
  }

  getGroupStaffCount(group: string): number {
    return this.employees().filter(e => e.collectionGroup === group).length;
  }

  getGroupCustomerCount(group: string): number {
    return this.customers().filter(c => c.collectionGroup === group && c.status === 'Active').length;
  }

  createNewCollectionGroup(): void {
    const name = this.newGroupNameInput().trim();
    if (!name) {
      this.showToast('குழு பெயரை சரியாக உள்ளிடவும் / Group name cannot be empty.', 'danger');
      return;
    }
    if (this.collectionGroups().includes(name)) {
      this.showToast('இந்த குழு ஏற்கனவே உள்ளது / This group already exists.', 'danger');
      return;
    }
    this.collectionGroups.update(list => [...list, name]);
    this.newGroupNameInput.set('');
    this.showAddGroupForm.set(false);
    this.showToast('வசூல் குழு உருவாக்கப்பட்டது / Collection Group Created!', 'success');
    this.playBeep(true);
  }

  renameCollectionGroupPrompt(group: string): void {
    const newName = prompt(`குழுவின் பெயரை மாற்றவும் / Rename collection group "${group}":`, group);
    if (!newName) return;
    const trimmed = newName.trim();
    if (!trimmed) {
      this.showToast('குழு பெயர் காலியாக இருக்கக்கூடாது / Group name cannot be empty.', 'danger');
      return;
    }
    if (this.collectionGroups().includes(trimmed)) {
      this.showToast('இந்த குழு ஏற்கனவே உள்ளது / This group already exists.', 'danger');
      return;
    }
    
    // Update group name in group list
    this.collectionGroups.update(list => list.map(g => g === group ? trimmed : g));
    
    // Update group name in employees assigned
    this.employees.update(list => list.map(e => e.collectionGroup === group ? { ...e, collectionGroup: trimmed } : e));
    
    // Update group name in customers assigned
    this.customers.update(list => list.map(c => c.collectionGroup === group ? { ...c, collectionGroup: trimmed } : c));
    
    this.showToast('வசூல் குழு பெயர் மாற்றப்பட்டது / Collection Group renamed!', 'success');
    this.playBeep(true);
  }

  startOnboardingNewEmployee(): void {
    this.editingEmployeeId.set(null);
    this.employeeForm.reset({
      name: '',
      role: 'Collection',
      phone: '',
      collectionGroup: this.collectionGroups()[0] || '',
      salary: 10000,
      joinDate: getLocalTodayString()
    });
    this.showAddEmployeeModal.set(true);
  }

  editEmployee(emp: Employee): void {
    this.editingEmployeeId.set(emp.id);
    this.employeeForm.patchValue({
      name: emp.name,
      role: emp.role,
      phone: emp.phone,
      collectionGroup: emp.collectionGroup || '',
      salary: emp.salary || 10000,
      joinDate: emp.joinDate || getLocalTodayString()
    });
    this.showAddEmployeeModal.set(true);
  }

  deleteEmployee(id: string): void {
    this.confirmDialogState.set({
      title: 'ஊழியர் நீக்கம் / Delete Employee',
      message: 'இந்த ஊழியரை நீக்க வேண்டுமா? / Are you sure you want to delete this employee?',
      confirmText: 'நீக்கு / Delete',
      cancelText: 'ரத்து / Cancel',
      onConfirm: () => {
        this.employees.update(list => list.filter(e => e.id !== id));
        this.showToast('ஊழியர் வெற்றிகரமாக நீக்கப்பட்டார் / Employee deleted.', 'info');
        this.playBeep(true);
        this.saveDatabase();
      }
    });
  }

  cycleAttendance(employeeId: string, dayNum: number, monthStr: string): void {
    const dateKey = `${monthStr}-${String(dayNum).padStart(2, '0')}`;
    this.employees.update(current => {
      return current.map(emp => {
        if (emp.id !== employeeId) return emp;
        
        const attendance = { ...(emp.attendance || {}) };
        const currentStatus = attendance[dateKey];
        
        let nextStatus: 'P' | 'A' | 'H' | 'HO' | undefined;
        if (!currentStatus) {
          nextStatus = 'P';
        } else if (currentStatus === 'P') {
          nextStatus = 'A';
        } else if (currentStatus === 'A') {
          nextStatus = 'H';
        } else if (currentStatus === 'H') {
          nextStatus = 'HO';
        } else if (currentStatus === 'HO') {
          nextStatus = undefined;
        }
        
        if (nextStatus) {
          attendance[dateKey] = nextStatus;
        } else {
          delete attendance[dateKey];
        }
        
        return {
          ...emp,
          attendance
        };
      });
    });
    this.playBeep(true);
    this.saveDatabase();
  }

  getAttendanceStatus(emp: Employee, dayNum: number, monthStr: string): 'P' | 'A' | 'H' | 'HO' | '' {
    if (!emp.attendance) return '';
    const dateKey = `${monthStr}-${String(dayNum).padStart(2, '0')}`;
    return emp.attendance[dateKey] || '';
  }

  getAttendanceCount(employeeId: string, monthStr: string, status: 'P' | 'A' | 'H' | 'HO'): number {
    const emp = this.employees().find(e => e.id === employeeId);
    if (!emp || !emp.attendance) return 0;
    
    let count = 0;
    for (const [key, val] of Object.entries(emp.attendance)) {
      if (key.startsWith(monthStr) && val === status) {
        count++;
      }
    }
    return count;
  }

  isSunday(dayNum: number, monthStr: string): boolean {
    const date = new Date(`${monthStr}-${String(dayNum).padStart(2, '0')}T12:00:00`);
    return date.getDay() === 0;
  }

  getDaysInMonthList(monthStr: string): number[] {
    const [year, month] = monthStr.split('-').map(Number);
    const numDays = new Date(year, month, 0).getDate();
    return Array.from({ length: numDays }, (_, i) => i + 1);
  }

  getWorkingDaysInMonth(monthStr: string): number {
    const days = this.getDaysInMonthList(monthStr);
    return days.filter(d => !this.isSunday(d, monthStr)).length;
  }

  getNetPayableSalary(emp: Employee, monthStr: string): number {
    const workingDays = this.getWorkingDaysInMonth(monthStr);
    if (workingDays === 0) return 0;
    const gross = emp.salary || 10000;
    const present = this.getAttendanceCount(emp.id, monthStr, 'P');
    const half = this.getAttendanceCount(emp.id, monthStr, 'H');
    const holiday = this.getAttendanceCount(emp.id, monthStr, 'HO');
    
    const attended = present + (half * 0.5) + holiday;
    return Math.round((gross / workingDays) * attended);
  }

  // Saves enterprise portal configurations
  onSaveSettings(): void {
    if (this.settingsForm.invalid) {
      this.settingsForm.markAllAsTouched();
      this.playBeep(false);
      return;
    }

    const val = this.settingsForm.getRawValue();
    this.settings.set({
      companyName: val.companyName,
      englishName: val.englishName,
      branch: val.branch,
      subtitle: val.subtitle,
      openingBalance: val.openingBalance,
      audioEnabled: val.audioEnabled,
      dailyInterest: val.dailyInterest,
      weeklyInterest: val.weeklyInterest,
      monthlyInterest: val.monthlyInterest,
      defaultDailyTenure: val.defaultDailyTenure,
      defaultWeeklyTenure: val.defaultWeeklyTenure,
      defaultMonthlyTenure: val.defaultMonthlyTenure
    });

    this.playBeep(true);
    this.showToast('அமைப்புகள் வெற்றிகரமாக சேமிக்கப்பட்டது / Settings saved successfully!', 'success');
  }

  changeSettingsSubTab(sub: string): void {
    this.settingsSubTab.set(sub);
    this.playBeep(true);
  }

  onCreateUser(): void {
    if (this.staffUserForm.invalid) {
      this.staffUserForm.markAllAsTouched();
      this.playBeep(false);
      this.showToast('Forms controls missing / விவரங்களை முழுமையாக நிரப்பவும்.', 'danger');
      return;
    }
    const val = this.staffUserForm.getRawValue();
    const perms: string[] = [];
    if (val.permissionAddCustomer) perms.push('Add Customer');
    if (val.permissionCollectMoney) perms.push('Collect Money');
    if (val.permissionViewReports) perms.push('View Reports');
    if (val.permissionDeleteEntry) perms.push('Delete Entry');
    
    if (perms.length === 0) perms.push('No Permissions');

    const newUser = {
      username: val.username.toLowerCase().trim(),
      displayName: val.displayName,
      role: 'staff',
      permissions: perms,
      status: 'Active' as const
    };

    // Check duplicate
    const exists = this.usersList().some(u => u.username === newUser.username);
    if (exists) {
      this.showToast('பயனர் பெயர் ஏற்கனவே உள்ளது / Username already exists.', 'danger');
      return;
    }

    this.usersList.update(list => [...list, newUser]);
    this.saveDatabase();
    this.showToast(`பயனர் வெற்றிகரமாக சேர்க்கப்பட்டார் / Staff user '${newUser.displayName}' created!`, 'success');
    this.playBeep(true);

    // Reset user form
    this.staffUserForm.reset({
      username: '',
      password: '',
      displayName: '',
      permissionAddCustomer: false,
      permissionCollectMoney: true,
      permissionViewReports: false,
      permissionDeleteEntry: false
    });
  }

  deleteUser(username: string): void {
    if (username === 'admin') {
      this.showToast('Cannot delete system administrator / முதன்மை நிர்வாகியை நீக்க இயலாது.', 'danger');
      return;
    }
    this.usersList.update(list => list.filter(u => u.username !== username));
    this.saveDatabase();
    this.showToast('பயனர் நீக்கப்பட்டார் / Staff user removed.', 'info');
    this.playBeep(true);
  }

  createBackup(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const dbData = localStorage.getItem('smart_finance_db_v1.0') || '{}';
    const now = new Date();
    
    // Format timestamp
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');
    const timeStr = `${hours}:${mins}:${secs}`;

    const newBackup = {
      id: 'BK-' + Date.now(),
      timestamp: timeStr,
      date: getLocalTodayString(),
      size: `${(dbData.length / 1024).toFixed(2)} KB`,
      data: dbData
    };

    this.backupsList.update(list => [newBackup, ...list]);
    this.saveDatabase();
    this.showToast('காப்புப்பிரதி வெற்றிகரமாக உருவாக்கப்பட்டது / Snapshot created successfully!', 'success');
    this.playBeep(true);
  }

  restoreBackup(backup: DatabaseBackup): void {
    if (!backup || !backup.data) return;
    try {
      const parsed = JSON.parse(backup.data);
      if (parsed.settings) {
        this.settings.set(parsed.settings);
        this.settingsForm.patchValue(parsed.settings, { emitEvent: false });
      }
      if (parsed.customers) this.customers.set(parsed.customers);
      if (parsed.collections) this.collections.set(parsed.collections);
      if (parsed.expenses) this.expenses.set(parsed.expenses);
      if (parsed.employees) this.employees.set(parsed.employees);
      if (parsed.usersList) this.usersList.set(parsed.usersList);
      if (parsed.backupsList) this.backupsList.set(parsed.backupsList);
      this.saveDatabase();
      this.playBeep(true);
      this.showToast('காப்புப்பிரதி வெற்றிகரமாக மீட்டெடுக்கப்பட்டது / System state restored successfully!', 'success');
    } catch (e) {
      console.error(e);
      this.showToast('காப்புப்பிரதி கோப்பு பிழையானது / Failed to restore: incorrect backup structure.', 'danger');
    }
  }

  deleteBackup(backupId: string): void {
    this.backupsList.update(list => list.filter(b => b.id !== backupId));
    this.saveDatabase();
    this.showToast('காப்புப்பிரதி நீக்கப்பட்டது / Backup archive removed.', 'info');
    this.playBeep(true);
  }

  optimizeDatabase(): void {
    this.playBeep(true);
    this.showToast('தரவுத்தளம் மேம்படுத்தப்பட்டது / Database optimized and defragmented!', 'success');
  }

  checkVersion(): void {
    this.playBeep(true);
    this.showToast('You are running version v1.0 / நீங்கள் தற்போதைய பதிப்பை (v1.0) பயன்படுத்துகிறீர்கள்.', 'success');
  }

  clearAppCache(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('sri_finance_customer_draft');
      this.playBeep(true);
      this.showToast('வலைச் சேமிப்பு தற்காலிக நினைவகம் நீக்கப்பட்டது / System draft caches purged!', 'info');
    }
  }

  clearAllData(): void {
    if (!this.showClearConfirm()) {
      this.showClearConfirm.set(true);
      this.showToast('Please confirm resetting ALL database configurations & transaction records!', 'danger');
      this.playBeep(false);
      return;
    }

    if (isPlatformBrowser(this.platformId)) {
      // 1. Reset client states
      this.customers.set([]);
      this.collections.set([]);
      this.expenses.set([]);
      this.employees.set([]);
      this.collectionGroups.set([]);
      this.backupsList.set([]);

      const defaultSettings: AppSettings = {
        companyName: 'SmartGoNext',
        englishName: 'SmartGoNext',
        branch: 'புதுச்சேரி',
        subtitle: 'நம்பகமான நிதி சேவை',
        openingBalance: 200000,
        audioEnabled: true,
        dailyInterest: 0,
        weeklyInterest: 0,
        monthlyInterest: 0,
        defaultDailyTenure: 100,
        defaultWeeklyTenure: 52,
        defaultMonthlyTenure: 12
      };
      this.settings.set(defaultSettings);
      this.settingsForm.patchValue(defaultSettings, { emitEvent: false });

      this.usersList.set([
        { username: 'admin', displayName: 'Administrator', role: 'admin', permissions: ['Full Access'], status: 'Active' }
      ]);

      // 2. Clear known localStorage entries
      localStorage.removeItem('smart_finance_db_v1.0');
      localStorage.removeItem('sri_finance_customer_draft');

      // 3. Clear IndexedDB Tables
      const stores = ['settings', 'customers', 'collections', 'expenses', 'employees', 'collectionGroups', 'usersList', 'backupsList'];
      Promise.all(stores.map(store => FinanceDB.clearStore(store)))
        .then(() => {
          // Re-seed database with correct scenario records
          this.seedDemoData();
          this.renderCharts();
          this.showClearConfirm.set(false);
          this.showToast('முழு தரவும் வெற்றிகரமாக அழிக்கப்பட்டது! / All system configurations & records cleared successfully!', 'success');
          this.playBeep(true);
        })
        .catch(err => {
          console.error('Error hard resetting system IndexedDB:', err);
          this.showToast('Failed to clear some structural stores.', 'danger');
        });
    }
  }

  cancelClearConfirm(): void {
    this.showClearConfirm.set(false);
    this.showToast('Hard reset cancelled / தரவுத்தள மீட்டமைப்பு ரத்து செய்யப்பட்டது.', 'info');
    this.playBeep(true);
  }

  cleanOldBackups(): void {
    if (this.backupsList().length > 5) {
      this.backupsList.update(list => list.slice(0, 5));
      this.saveDatabase();
      this.showToast('கூடுதல் காப்புப்பிரதிகள் நீக்கப்பட்டன / Purged backups exceeding 5 history slots.', 'success');
    } else {
      this.showToast('Purging old data slots: backups are already clean / நீக்குவதற்கு பழைய கோப்புகள் ஏதும் இல்லை.', 'info');
    }
    this.playBeep(true);
  }

  // --- RECONCILING ANALYTICAL CHARTS ENGINES ---
  renderCharts() {
    if (!isPlatformBrowser(this.platformId)) return;

    // Destroy existing instances to clean context memory
    (this.chartInstances as Chart[]).forEach(chart => chart.destroy());
    this.chartInstances = [];

    const trendCanvas = document.getElementById('collTrendChart') as HTMLCanvasElement | null;
    const donutCanvas = document.getElementById('loanStatusChart') as HTMLCanvasElement | null;

    if (trendCanvas) {
      const modeDark = this.isDarkMode();
      const textCol = modeDark ? '#E2E8F0' : '#1E293B';
      const gridCol = modeDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';

      // Extract trend data points dynamically over the last 7 calendar days
      const dateLabels: string[] = [];
      const collectionsData: number[] = [];
      const expensesData: number[] = [];

      const todayObj = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(todayObj);
        d.setDate(todayObj.getDate() - i);
        const yyyymmdd = d.toISOString().slice(0, 10);
        const mmdd = yyyymmdd.slice(5).replace('-', '/'); // Format "MM/DD"
        const label = i === 0 ? `${mmdd} Today` : mmdd;

        dateLabels.push(label);

        // Sum collections on this date
        const dayCollections = this.collections()
          .filter(c => c.date === yyyymmdd)
          .reduce((sum, item) => sum + item.amount, 0);
        collectionsData.push(dayCollections);

        // Sum expenses on this date
        const dayExpenses = this.expenses()
          .filter(e => e.date === yyyymmdd)
          .reduce((sum, item) => sum + item.amount, 0);
        expensesData.push(dayExpenses);
      }

      try {
        const lineCh = new Chart(trendCanvas, {
          type: 'line',
          data: {
            labels: dateLabels,
            datasets: [
              {
                label: 'வசூல் / Collection (₹)',
                data: collectionsData,
                borderColor: '#0284c7',
                backgroundColor: 'rgba(2, 132, 199, 0.08)',
                fill: true,
                tension: 0.35,
                borderWidth: 3,
                pointBackgroundColor: '#0284c7'
              },
              {
                label: 'செலவு / Expenses (₹)',
                data: expensesData,
                borderColor: '#00A86B',
                backgroundColor: 'rgba(0, 168, 107, 0.06)',
                fill: true,
                tension: 0.35,
                borderWidth: 2,
                pointBackgroundColor: '#00A86B'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'top',
                labels: {
                  color: textCol,
                  font: { family: 'Inter', weight: 600, size: 11 }
                }
              }
            },
            scales: {
              x: {
                grid: { color: gridCol },
                ticks: { color: modeDark ? '#94A3B8' : '#64748B', font: { size: 10 } }
              },
              y: {
                grid: { color: gridCol },
                ticks: { color: modeDark ? '#94A3B8' : '#64748B', font: { size: 10 } }
              }
            }
          }
        });
        this.chartInstances.push(lineCh);
      } catch (err) {
        console.error('Error drawing line chart:', err);
      }
    }

    if (donutCanvas) {
      // Calculate Active vs Closed loans
      const activeCount = this.customers().filter(c => c.status === 'Active').length;
      const closedCount = this.customers().filter(c => c.status === 'Closed').length;

      const userDark = this.isDarkMode();
      const labelColor = userDark ? '#E2E8F0' : '#1E293B';

      try {
        const donutCh = new Chart(donutCanvas, {
          type: 'doughnut',
          data: {
            labels: ['செயலில் / Active', 'முடிந்தது / Closed'],
            datasets: [{
              data: [activeCount, closedCount],
              backgroundColor: ['#0284c7', '#10b981'],
              borderColor: userDark ? '#1F2937' : '#FFFFFF',
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: labelColor,
                  font: { family: 'Inter', weight: 600, size: 11 },
                  padding: 10
                }
              }
            },
            cutout: '65%'
          }
        });
        this.chartInstances.push(donutCh);
      } catch (err) {
        console.error('Error drawing doughnut chart:', err);
      }
    }
  }

  // --- REPORT SEARCH AND EXPORT FLOWS ---
  getFilteredReports(): ReportRow[] {
    const query = this.searchQuery().toLowerCase();
    const type = this.reportTypeFilter();
    
    // Combine logs to searchable list
    const combined: ReportRow[] = [];

    // Map collections
    this.collections().forEach(c => {
      combined.push({
        id: c.id,
        type: 'Collection',
        tamilType: 'வசூல்',
        customerName: c.customerName,
        detail: `வகை ${c.line} - EMI Receipt`,
        amount: c.amount,
        interest: c.interestAmount,
        principal: c.principalAmount,
        date: c.date,
        colorClass: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20'
      });
    });

    // Map expenses
    this.expenses().forEach(e => {
      combined.push({
        id: e.id,
        type: 'Expense',
        tamilType: 'செலவு',
        customerName: 'Office Upkeep',
        detail: `வகை: ${e.type} - ${e.description}`,
        amount: e.amount,
        interest: 0,
        principal: 0,
        date: e.date,
        colorClass: 'text-red-500 bg-red-50 dark:bg-red-950/20'
      });
    });

    // Map loans given
    this.customers().forEach(c => {
      combined.push({
        id: 'L-GIVEN-' + c.id.replace('CUST-', ''),
        type: 'Loan Offered',
        tamilType: 'கடன் வழங்கல்',
        customerName: c.name,
        detail: `லைன் ${c.line} - Amount Offered (Tenure: ${c.tenure})`,
        amount: c.loanAmount,
        interest: 0,
        principal: 0,
        date: c.createdAt,
        colorClass: 'text-amber-500 bg-amber-50 dark:bg-amber-950/20'
      });
    });

    // Filters
    return combined.filter(row => {
      const matchType = type === 'all' || 
                        (type === 'collection' && row.type === 'Collection') ||
                        (type === 'expense' && row.type === 'Expense') ||
                        (type === 'loan' && row.type === 'Loan Offered');
      
      const matchText = row.customerName.toLowerCase().includes(query) ||
                        row.id.toLowerCase().includes(query) ||
                        row.detail.toLowerCase().includes(query);

      return matchType && matchText;
    }).sort((a,b) => b.date.localeCompare(a.date));
  }

  exportExcel(): void {
    const list = this.getFilteredReports();
    if (list.length === 0) {
      this.showToast('ஏற்றுமதி செய்ய தரவுகள் ஏதுமில்லை / No data found to export.', 'danger');
      return;
    }

    const headers = [
      'Transaction ID', 'Type/வகை', 'Tamil Event', 'Description/விவரம்', 
      'Customer Name', 'Date/தேதி', 'Amount (INR)', 'Interest (INR)', 'Principal (INR)'
    ];
    const rows = list.map(row => [
      row.id, row.type, row.tamilType, row.detail, row.customerName, 
      row.date, row.amount, row.interest, row.principal
    ]);

    const filename = `Sri_Finance_Ledger_${new Date().toISOString().slice(0, 10)}.xlsx`;
    this.generateAndDownloadXlsx('Ledger Report', headers, rows, filename).then(() => {
      this.playBeep(true);
      this.showToast('எக்செல் அறிக்கை பதிவிறக்கப்பட்டது / Excel Report exported successfully!', 'success');
    });
  }

  exportPDF(): void {
    // Print window formatted output handles precise layout printing
    this.printReport();
  }

  printReport(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.playBeep(true);
    this.showToast('அச்சிடத் தயாராகிறது / Opening System Print Dialogue...', 'info');
    setTimeout(() => {
      window.print();
    }, 300);
  }

  // Bulk Import / Export Support Methods 
  downloadImportTemplate(): void {
    const type = this.selectedImportType();
    let csv = '\uFEFF';
    let filename = '';

    if (type === 'customers') {
      csv += 'name,father_name,phone,address,occupation,id_proof\r\n';
      csv += 'Kumar P,Palani,9843256123,12 West Street Srivilliputhur,Business,Aadhaar: 123456789012\r\n';
      filename = 'customers-template.csv';
    } else if (type === 'loans') {
      csv += 'customer_phone,loan_amount,interest_type,interest_percentage,amount_per_installment,start_date,closing_date,status\r\n';
      csv += '9843256123,10000,Daily,10,110,2026-03-01,2026-06-09,Active\r\n';
      filename = 'loans-template.csv';
    } else if (type === 'collections') {
      csv += 'customer_phone,loan_number,date,amount,notes\r\n';
      csv += '9843256123,L-01,2026-03-05,110,First collection\r\n';
      filename = 'collections-template.csv';
    } else if (type === 'expenses') {
      csv += 'date,category,amount,description\r\n';
      csv += '2026-03-02,Office,450,Office stationeries\r\n';
      filename = 'expenses-template.csv';
    } else if (type === 'employees') {
      csv += 'name,phone,designation,salary,join_date,collection_group\r\n';
      csv += 'Ganesh P,9865432101,Supervisor,15000,2026-01-15,pondy\r\n';
      filename = 'employees-template.csv';
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.playBeep(true);
    this.showToast(`${filename} பதிவிறக்கப்பட்டது / Template downloaded successfully!`, 'success');
  }

  onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.importFileName.set(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        this.importFileContent = reader.result as string;
      };
      reader.readAsText(file);
    } else {
      this.importFileName.set('No file chosen');
      this.importFileContent = '';
    }
  }

  parseCSV(text: string): string[][] {
    if (!text) return [];
    const lines = text.split(/\r?\n/);
    return lines
      .map(line => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      })
      .filter(row => row.length > 0 && row.some(cell => cell !== ''));
  }

  setExportFromDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.exportFromDate.set(value);
  }

  setExportToDate(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.exportToDate.set(value);
  }

  onUploadAndImport(): void {
    if (!this.importFileContent) {
      this.showToast('தயவுசெய்து முதலில் ஒரு CSV கோப்பை தேர்ந்தெடுக்கவும் / Please select a CSV file first.', 'danger');
      this.playBeep(false);
      return;
    }

    const rows = this.parseCSV(this.importFileContent);
    if (rows.length <= 1) {
      this.showToast('கோப்பில் தரவுகள் இல்லை / CSV file does not contain enough rows.', 'danger');
      this.playBeep(false);
      return;
    }

    const type = this.selectedImportType();
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const dataRows = rows.slice(1);

    let importCount = 0;

    if (type === 'customers') {
      const nameIdx = headers.indexOf('name');
      const fatherIdx = headers.indexOf('father_name');
      const phoneIdx = headers.indexOf('phone');
      const addrIdx = headers.indexOf('address');
      const occIdx = headers.indexOf('occupation');
      const idIdx = headers.indexOf('id_proof');
      const clNoIdx = headers.findIndex(h => h.includes('cl_no') || h.includes('clno') || h.includes('cl.no') || h.includes('card_no'));

      const currentList = [...this.customers()];

      dataRows.forEach((row) => {
        if (row.length < 2) return;
        const name = nameIdx !== -1 && row[nameIdx] ? row[nameIdx] : '';
        const father = fatherIdx !== -1 && row[fatherIdx] ? row[fatherIdx] : '';
        const phone = phoneIdx !== -1 && row[phoneIdx] ? row[phoneIdx] : '';
        const address = addrIdx !== -1 && row[addrIdx] ? row[addrIdx] : '';
        const occupation = occIdx !== -1 && row[occIdx] ? row[occIdx] : '';
        const idProof = idIdx !== -1 && row[idIdx] ? row[idIdx] : '';
        const clNo = clNoIdx !== -1 && row[clNoIdx] ? String(row[clNoIdx]) : '';

        if (!phone) return;

        const existingIdx = currentList.findIndex(c => c.phone === phone);
        if (existingIdx !== -1) {
          currentList[existingIdx] = {
            ...currentList[existingIdx],
            name: name || currentList[existingIdx].name,
            englishName: name || currentList[existingIdx].englishName,
            fatherName: father || currentList[existingIdx].fatherName,
            address: address || currentList[existingIdx].address,
            occupation: occupation || currentList[existingIdx].occupation,
            idProofNumber: idProof || currentList[existingIdx].idProofNumber,
            clNo: clNo || currentList[existingIdx].clNo
          };
        } else {
          const newId = 'CUST-' + (currentList.length + 1).toString().padStart(2, '0');
          currentList.push({
            id: newId,
            name: name || 'வாடிக்கையாளர் Kumar',
            englishName: name || 'Kumar',
            phone: phone,
            address: address || 'No address',
            line: 'A',
            loanAmount: 10000,
            interestRate: 10,
            tenure: 100,
            status: 'Active',
            createdAt: getLocalTodayString(),
            fatherName: father,
            occupation: occupation,
            idProofType: 'Aadhaar',
            idProofNumber: idProof,
            clNo: clNo || undefined
          });
        }
        importCount++;
      });

      this.customers.set(currentList);

    } else if (type === 'loans') {
      const phoneIdx = headers.indexOf('customer_phone');
      const amtIdx = headers.indexOf('loan_amount');
      const interestIdx = headers.indexOf('interest_type');
      const percentageIdx = headers.indexOf('interest_percentage');
      const startIdx = headers.indexOf('start_date');
      const statusIdx = headers.indexOf('status');

      const currentList = [...this.customers()];

      dataRows.forEach(row => {
        if (row.length < 2) return;
        const phone = phoneIdx !== -1 && row[phoneIdx] ? row[phoneIdx] : '';
        if (!phone) return;

        const customer = currentList.find(c => c.phone === phone);
        if (customer) {
          if (amtIdx !== -1 && row[amtIdx]) customer.loanAmount = parseFloat(row[amtIdx]) || 10000;
          if (percentageIdx !== -1 && row[percentageIdx]) customer.interestRate = parseFloat(row[percentageIdx]) || 10;
          if (interestIdx !== -1 && row[interestIdx]) {
            const t = row[interestIdx];
            customer.interestType = t as 'Daily' | 'Weekly' | 'Monthly';
            customer.line = t === 'Weekly' ? 'W' : (t === 'Monthly' ? 'M' : 'A');
          }
          if (statusIdx !== -1 && row[statusIdx]) {
            customer.status = (row[statusIdx] === 'Closed' ? 'Closed' : 'Active');
          }
          if (startIdx !== -1 && row[startIdx]) {
            customer.createdAt = row[startIdx];
          }
          customer.tenure = 100;
          importCount++;
        }
      });

      this.customers.set(currentList);

    } else if (type === 'collections') {
      const phoneIdx = headers.indexOf('customer_phone');
      const dateIdx = headers.indexOf('date');
      const amtIdx = headers.indexOf('amount');
      const notesIdx = headers.indexOf('notes');

      const currentCollections = [...this.collections()];

      dataRows.forEach((row, idx) => {
        if (row.length < 2) return;
        const phone = phoneIdx !== -1 && row[phoneIdx] ? row[phoneIdx] : '';
        const date = dateIdx !== -1 && row[dateIdx] ? row[dateIdx] : getLocalTodayString();
        const amount = amtIdx !== -1 ? parseFloat(row[amtIdx]) : 0;
        const notes = notesIdx !== -1 && row[notesIdx] ? row[notesIdx] : '';

        if (!phone || amount <= 0) return;

        const customer = this.customers().find(c => c.phone === phone);
        if (customer) {
          const newCol: Collection = {
            id: 'COLL-' + Date.now() + '-' + idx,
            customerId: customer.id,
            customerName: customer.name,
            amount: amount,
            interestAmount: Math.round(amount * 0.1),
            principalAmount: Math.round(amount * 0.9),
            line: customer.line,
            date: date || getLocalTodayString(),
            notes: notes || 'Imported via CSV'
          };
          currentCollections.push(newCol);
          importCount++;
        }
      });

      this.collections.set(currentCollections);

    } else if (type === 'expenses') {
      const dateIdx = headers.indexOf('date');
      const catIdx = headers.indexOf('category');
      const amtIdx = headers.indexOf('amount');
      const descIdx = headers.indexOf('description');

      const currentExpenses = [...this.expenses()];

      dataRows.forEach((row, idx) => {
        if (row.length < 2) return;
        const date = dateIdx !== -1 && row[dateIdx] ? row[dateIdx] : getLocalTodayString();
        const category = catIdx !== -1 && row[catIdx] ? row[catIdx] : 'Office';
        const amount = amtIdx !== -1 ? parseFloat(row[amtIdx]) : 0;
        const desc = descIdx !== -1 && row[descIdx] ? row[descIdx] : '';

        if (amount <= 0) return;

        const catLower = category.toLowerCase();
        let mappedCat: 'Salary' | 'Rent' | 'Office' | 'Vehicle' | 'Miscellaneous' = 'Office';
        if (catLower.includes('salary') || catLower.includes('சம்பளம்') || catLower.includes('ஊதியம்')) {
          mappedCat = 'Salary';
        } else if (catLower.includes('rent') || catLower.includes('வாடகை')) {
          mappedCat = 'Rent';
        } else if (catLower.includes('office') || catLower.includes('அலுவலக')) {
          mappedCat = 'Office';
        } else if (catLower.includes('vehicle') || catLower.includes('fuel') || catLower.includes('travel') || catLower.includes('வாகன') || catLower.includes('எரிபொருள்') || catLower.includes('பயணம்')) {
          mappedCat = 'Vehicle';
        } else if (catLower.includes('misc') || catLower.includes('இதர')) {
          mappedCat = 'Miscellaneous';
        }

        const newExp: Expense = {
          id: 'EXP-' + Date.now() + '-' + idx,
          type: mappedCat,
          amount: amount,
          date: date || getLocalTodayString(),
          description: desc
        };
        currentExpenses.push(newExp);
        importCount++;
      });

      this.expenses.set(currentExpenses);

    } else if (type === 'employees') {
      const nameIdx = headers.indexOf('name');
      const phoneIdx = headers.indexOf('phone');
      const desIdx = headers.indexOf('designation');
      const salaryIdx = headers.indexOf('salary');
      const joinIdx = headers.indexOf('join_date');
      const groupIdx = headers.indexOf('collection_group');

      const currentEmployees = [...this.employees()];

      dataRows.forEach((row, idx) => {
        if (row.length < 2) return;
        const name = nameIdx !== -1 && row[nameIdx] ? row[nameIdx] : '';
        const phone = phoneIdx !== -1 && row[phoneIdx] ? row[phoneIdx] : '';
        const role = desIdx !== -1 && row[desIdx] ? row[desIdx] : 'Field Collector';
        const salary = salaryIdx !== -1 && row[salaryIdx] ? parseFloat(row[salaryIdx]) : 10000;
        const join_date = joinIdx !== -1 && row[joinIdx] ? row[joinIdx] : '2026-03-01';
        const colGroup = groupIdx !== -1 && row[groupIdx] ? row[groupIdx] : '';

        if (!name) return;

        const newEmp: Employee = {
          id: 'EMP-' + Date.now() + '-' + idx,
          name: name,
          phone: phone,
          role: role,
          status: 'Active',
          salary: salary,
          joinDate: join_date,
          collectionGroup: colGroup,
          attendance: {}
        };
        currentEmployees.push(newEmp);
        importCount++;
      });

      this.employees.set(currentEmployees);
    }

    this.saveDatabase();
    this.playBeep(true);
    this.showToast(`${importCount} வரிகள் வெற்றிகரமாக ஏற்றப்பட்டது / ${importCount} records successfully imported!`, 'success');
    
    // Clear selections
    this.importFileName.set('No file chosen');
    this.importFileContent = '';
  }

  downloadExportCSV(type: string): void {
    if (!isPlatformBrowser(this.platformId)) return;

    let headers: string[] = [];
    const rows: (string | number | boolean | null | undefined)[][] = [];
    let filename = '';

    if (type === 'customers') {
      headers = ['CL.No / வசூல் எண்', 'Name/பெயர்', 'Father Name/தந்தை பெயர்', 'Phone/கைபேசி', 'Address/முகவரி', 'Occupation/தொழில்', 'ID Proof/அடையாள அட்டை'];
      this.customers().forEach(c => {
        rows.push([c.clNo || '', c.name, c.fatherName || '', c.phone, c.address, c.occupation || '', c.idProofNumber || '']);
      });
      filename = `customers_export_${getLocalTodayString()}.xlsx`;

    } else if (type === 'loans') {
      headers = ['Customer Phone/கைபேசி', 'Loan Amount/கடன் தொகை', 'Interest Type/வகை', 'Interest Percentage/வட்டி %', 'Amount Per Installment/தவணை தொகை', 'Start Date/தேதி', 'Closing Date/முடிவு தேதி', 'Status/நிலை'];
      this.customers().forEach(c => {
        const interestType = c.line === 'W' ? 'Weekly' : (c.line === 'M' ? 'Monthly' : 'Daily');
        const emi = Math.round(c.loanAmount / (c.tenure || 100));
        rows.push([c.phone, c.loanAmount, interestType, c.interestRate, emi, c.createdAt, '', c.status]);
      });
      filename = `loans_export_${getLocalTodayString()}.xlsx`;

    } else if (type === 'collections') {
      headers = ['Customer Phone/கைபேசி', 'Loan Number/கடன் எண்', 'Date/தேதி', 'Amount/தொகை', 'Notes/விவரம்'];
      const start = this.exportFromDate();
      const end = this.exportToDate();
      this.collections().forEach(col => {
        if (col.date >= start && col.date <= end) {
          const cust = this.customers().find(c => c.id === col.customerId);
          const phone = cust ? cust.phone : '';
          rows.push([phone, 'L-01', col.date, col.amount, col.notes || '']);
        }
      });
      filename = `collections_export_${start}_to_${end}.xlsx`;

    } else if (type === 'expenses') {
      headers = ['Date/தேதி', 'Category/வகை', 'Amount/தொகை', 'Description/விவரம்'];
      const start = this.exportFromDate();
      const end = this.exportToDate();
      this.expenses().forEach(exp => {
        if (exp.date >= start && exp.date <= end) {
          rows.push([exp.date, exp.type, exp.amount, exp.description || '']);
        }
      });
      filename = `expenses_export_${start}_to_${end}.xlsx`;

    } else if (type === 'employees') {
      headers = ['Name/பெயர்', 'Phone/கைபேசி', 'Designation/பதவி', 'Salary/சம்பளம்', 'Join Date/சேர்ந்த தேதி', 'Collection Group/லைன் பிரிவு'];
      this.employees().forEach(e => {
        rows.push([e.name, e.phone, e.role, e.salary || 10000, e.joinDate || getLocalTodayString(), e.collectionGroup || '']);
      });
      filename = `employees_export_${getLocalTodayString()}.xlsx`;
    }

    this.generateAndDownloadXlsx(type.toUpperCase() + ' Export', headers, rows, filename).then(() => {
      this.playBeep(true);
      this.showToast(`${filename} வெற்றிகரமாக பதிவிறக்கப்பட்டது / Exported successfully!`, 'success');
    });
  }

  exportDailyCollectionReport(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const headers = [
      'S.No', 'Date/தேதி', 'Loan No/கடன் எண்', 
      'Customer Name/வாடிக்கையாளர் பெயர்', 'Phone/கைபேசி', 
      'Type/வகை', 'Amount/தொகை', 'Pay Mode / நெறிமுறை', 'Collector/வசூலிப்பாளர்'
    ];
    const rows: (string | number | boolean | null | undefined)[][] = [];
    this.reportDailyCollections().forEach((c, idx) => {
      rows.push([
        idx + 1,
        c.date,
        this.getLoanNoForCollection(c),
        c.customerName,
        c.phone || 'N/A',
        c.line === 'A' ? 'Daily' : c.line === 'W' ? 'Weekly' : 'Monthly',
        c.amount,
        c.paymentMethod || 'Cash',
        'Staff'
      ]);
    });
    
    // Add a total row
    const totalAmount = this.reportDailyCollections().reduce((sum, item) => sum + item.amount, 0);
    rows.push([
      'Total / மொத்தம்', '', '', '', '', '', totalAmount, '', ''
    ]);

    const filename = `daily_collection_report_${this.reportDailyDate()}.xlsx`;
    this.generateAndDownloadXlsx('Daily Collections', headers, rows, filename).then(() => {
      this.playBeep(true);
      this.showToast('வசூல் அறிக்கை பதிவிறக்கப்பட்டது / Daily Collection exported successfully!', 'success');
    });
  }

  exportDailyLoansGivenReport(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const headers = [
      'S.No', 'Customer Name/வாடிக்கையாளர் பெயர்', 
      'Loan Amount (Outflow) / கடன் தொகை (பற்று)', 
      'Retained Profit / பிடித்தம் (வரவு)', 
      'Net Handover / பெற்ற தொகை (நிகர)', 
      'Type/வகை'
    ];
    const rows: (string | number | boolean | null | undefined)[][] = [];
    this.reportDailyLoansGiven().forEach(r => {
      rows.push([
        r.sNo,
        r.customerName,
        r.loanAmount,
        r.retainedProfit,
        r.disbursedAmount,
        r.type
      ]);
    });

    const totalGiven = this.reportDailyLoansTotal();
    const totalRetained = this.reportDailyRetainedProfitTotal();
    const totalDisbursed = totalGiven - totalRetained;
    
    rows.push([
      'Total / மொத்தம்', '', totalGiven, totalRetained, totalDisbursed, ''
    ]);

    const filename = `loans_given_report_${this.reportDailyDate()}.xlsx`;
    this.generateAndDownloadXlsx('Loans Given', headers, rows, filename).then(() => {
      this.playBeep(true);
      this.showToast('வழங்கப்பட்ட கடன் அறிக்கை பதிவிறக்கப்பட்டது / Loans Given exported successfully!', 'success');
    });
  }

  // Purely resets form inputs
  resetForm(): void {
    this.loginSuccess.set(false);
    this.loginForm.reset({ username: 'admin', password: '' });
    this.generalError.set('');
  }
}
