'use strict';

// Lightweight taxonomy-based classifier for English-language sites.
// Each top-level category has weighted keyword signals, plus a list of
// possible sub-categories. The classifier returns the top-level + best sub.

const TAXONOMY = [
  {
    id: 'finance_bank',
    label: 'Banks & Finance',
    sub: ['Retail Banking', 'Investment Banking', 'Insurance', 'Wealth Management', 'Crypto Exchange', 'Fintech'],
    keywords: [
      'bank', 'banking', 'savings account', 'checking account', 'loan', 'mortgage',
      'credit card', 'debit card', 'deposit', 'withdraw', 'atm', 'wire transfer',
      'interest rate', 'apy', 'apr', 'iban', 'swift', 'branch', 'customer service',
      'open an account', 'financial institution', 'insurance', 'policy', 'claim',
      'premium', 'underwrite', 'wealth', 'asset management', 'portfolio',
      'crypto', 'bitcoin', 'ethereum', 'exchange', 'wallet', 'blockchain',
    ],
    weight: 1.0,
  },
  {
    id: 'b2b_saas',
    label: 'B2B SaaS',
    sub: ['CRM', 'Marketing Automation', 'HR Tech', 'Dev Tools', 'Analytics', 'Cybersecurity', 'Project Management', 'Finance Ops', 'Customer Support', 'Productivity'],
    keywords: [
      'platform', 'workflow', 'integration', 'api', 'sdk', 'enterprise', 'saas',
      'team', 'collaboration', 'productivity', 'onboarding', 'pricing plans',
      'free trial', 'book a demo', 'request demo', 'sign up free', 'sign-up',
      'customers', 'case study', 'roi', 'crm', 'sales pipeline', 'leads',
      'marketing automation', 'email campaigns', 'ab test', 'a/b test',
      'human resources', 'applicant tracking', 'payroll', 'performance review',
      'developer', 'repository', 'ci/cd', 'continuous integration', 'observability',
      'analytics', 'dashboard', 'metrics', 'events', 'funnel',
      'vulnerability', 'threat detection', 'siem', 'compliance', 'soc 2',
      'project management', 'tasks', 'sprint', 'kanban', 'gantt',
      'ticketing', 'help desk', 'knowledge base',
    ],
    weight: 1.1,
  },
  {
    id: 'b2c_retail',
    label: 'B2C Retail & eCommerce',
    sub: ['Fashion & Apparel', 'Beauty', 'Electronics', 'Home & Garden', 'Food & Grocery', 'Pet', 'Toys & Hobbies', 'Sports & Outdoors'],
    keywords: [
      'shop', 'store', 'cart', 'checkout', 'add to cart', 'buy now', 'order',
      'shipping', 'delivery', 'returns', 'refund', 'size guide', 'fit',
      'collection', 'new arrivals', 'sale', 'discount', 'coupon', 'promo code',
      'fashion', 'clothing', 'dress', 'shirt', 'shoes', 'sneakers',
      'skincare', 'makeup', 'cosmetics', 'fragrance',
      'tv', 'laptop', 'phone', 'headphones', 'camera', 'gaming',
      'furniture', 'kitchen', 'bedroom', 'garden', 'decor',
      'grocery', 'recipe', 'ingredients', 'fresh', 'organic',
      'dog', 'cat', 'pet food', 'leash', 'kennel',
      'toy', 'hobby', 'craft', 'model', 'puzzle',
      'sports', 'fitness', 'outdoor', 'camping', 'bike',
    ],
    weight: 1.0,
  },
  {
    id: 'travel',
    label: 'Travel & Hospitality',
    sub: ['Hotels', 'Airlines', 'Booking', 'Tours & Activities', 'Restaurants', 'Vacation Rentals'],
    keywords: [
      'hotel', 'reservation', 'book a room', 'check-in', 'check-out', 'suite',
      'airline', 'flight', 'boarding', 'airport', 'mileage',
      'booking', 'book now', 'itinerary', 'trip', 'travel', 'tour', 'tourist',
      'destination', 'attraction', 'museum', 'ticket',
      'restaurant', 'menu', 'reservation', 'dine-in', 'takeout',
      'vacation rental', 'apartment', 'airbnb', 'short stay',
    ],
    weight: 1.0,
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    sub: ['Hospital', 'Clinic', 'Telehealth', 'Pharmacy', 'Wellness', 'Dental', 'Mental Health'],
    keywords: [
      'patient', 'doctor', 'physician', 'clinic', 'hospital', 'appointment',
      'diagnosis', 'treatment', 'symptom', 'prescription', 'pharmacy',
      'medication', 'drug', 'dose', 'side effects', 'fda',
      'therapy', 'counseling', 'mental health', 'wellness', 'fitness',
      'dentist', 'orthodontist', 'dental', 'teeth', 'cavity',
      'telehealth', 'virtual visit', 'telemedicine',
    ],
    weight: 1.0,
  },
  {
    id: 'education',
    label: 'Education',
    sub: ['K-12', 'Higher Education', 'Online Courses', 'EdTech', 'Tutoring', 'Language Learning'],
    keywords: [
      'school', 'university', 'college', 'degree', 'bachelor', 'master', 'phd',
      'course', 'curriculum', 'syllabus', 'lecture', 'professor', 'student',
      'enroll', 'enrollment', 'tuition', 'scholarship', 'campus',
      'online course', 'video lesson', 'mooc', 'certificate', 'bootcamp',
      'tutor', 'tutoring', 'homework help', 'test prep', 'sat', 'act',
      'language', 'learn spanish', 'learn english', 'vocabulary', 'grammar',
    ],
    weight: 1.0,
  },
  {
    id: 'media',
    label: 'Media & Publishing',
    sub: ['News', 'Magazine', 'Blog Network', 'Streaming', 'Podcast', 'Sports Media'],
    keywords: [
      'news', 'article', 'reporter', 'journalist', 'breaking', 'latest',
      'opinion', 'editorial', 'magazine', 'feature', 'interview',
      'subscribe', 'newsletter', 'editorial team', 'staff writer',
      'streaming', 'watch online', 'episode', 'season', 'series', 'premiere',
      'podcast', 'listen now', 'audio', 'episode',
      'scores', 'standings', 'league', 'match', 'team news',
    ],
    weight: 1.0,
  },
  {
    id: 'real_estate',
    label: 'Real Estate',
    sub: ['Residential', 'Commercial', 'Property Management', 'Listings', 'Mortgage Broker'],
    keywords: [
      'real estate', 'property', 'listing', 'mls', 'realtor', 'broker',
      'for sale', 'for rent', 'rent', 'lease', 'condo', 'apartment',
      'house', 'townhouse', 'land', 'commercial property', 'office space',
      'tenant', 'landlord', 'property management', 'eviction',
      'mortgage broker', 'home loan', 'refinance',
    ],
    weight: 1.0,
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    sub: ['Services Marketplace', 'Goods Marketplace', 'Freelance', 'Rental Marketplace'],
    keywords: [
      'marketplace', 'list your business', 'find a pro', 'find a service',
      'get quotes', 'request a quote', 'compare', 'directory',
      'freelancer', 'hire', 'gig', 'service provider',
      'auction', 'bid', 'listing fee',
    ],
    weight: 1.0,
  },
  {
    id: 'government',
    label: 'Government & Public Sector',
    sub: ['Federal', 'State', 'Local', 'Healthcare Authority', 'Education Authority'],
    keywords: [
      'government', 'official', 'department of', 'ministry', 'agency',
      'public service', 'citizen', 'permit', 'license', 'regulation',
      'tax', 'irs', 'social security', 'passport', 'visa', 'immigration',
      'legislation', 'policy', 'public health',
    ],
    weight: 1.0,
  },
  {
    id: 'nonprofit',
    label: 'Nonprofit & NGO',
    sub: ['Charity', 'Foundation', 'Advocacy', 'Religious'],
    keywords: [
      'donate', 'donation', 'charity', 'foundation', 'nonprofit', 'non-profit',
      'mission', 'volunteer', 'cause', 'advocacy', 'awareness',
      'church', 'synagogue', 'mosque', 'parish', 'worship', 'faith',
    ],
    weight: 0.9,
  },
  {
    id: 'tech_hardware',
    label: 'Tech Hardware / Consumer Electronics',
    sub: ['Smartphones', 'Computers', 'Wearables', 'Audio', 'Smart Home', 'Components'],
    keywords: [
      'specifications', 'specs', 'model number', 'release date', 'pre-order',
      'buy', 'where to buy', 'accessories', 'warranty', 'manual',
      'gpu', 'cpu', 'processor', 'memory', 'storage', 'ssd', 'ram',
    ],
    weight: 0.9,
  },
  {
    id: 'gaming',
    label: 'Gaming',
    sub: ['Game Studio', 'Gaming Platform', 'Esports', 'Gaming Hardware', 'Game Media'],
    keywords: [
      'game', 'games', 'gaming', 'player', 'multiplayer', 'single player',
      'dlc', 'season pass', 'in-game', 'loot box', 'cosmetics',
      'esports', 'tournament', 'match', 'ranked',
      'steam', 'playstation', 'xbox', 'nintendo', 'epic games',
    ],
    weight: 1.0,
  },
  {
    id: 'agency',
    label: 'Agency / Consultancy',
    sub: ['Marketing Agency', 'Design Agency', 'Software Agency', 'Consulting Firm'],
    keywords: [
      'agency', 'we are', 'our work', 'our team', 'our clients', 'services',
      'case studies', 'portfolio', 'branding', 'creative',
      'consulting', 'advisory', 'strategy', 'transformation',
    ],
    weight: 0.9,
  },
];

function classify(text) {
  if (!text) return { category: null, category_sub: null, score: 0, signals: [] };
  const lower = text.toLowerCase();

  const scores = TAXONOMY.map((cat) => {
    let s = 0;
    const matched = [];
    for (const kw of cat.keywords) {
      // Word-ish match; \b boundaries so "tea" does not match "team".
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
      if (re.test(lower)) {
        s += cat.weight;
        matched.push(kw);
      }
    }
    return { ...cat, score: s, matched };
  }).filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scores.length) {
    return { category: null, category_sub: null, score: 0, signals: [] };
  }

  const top = scores[0];
  // Determine best sub-category by matching sub keywords from the top category
  let bestSub = null;
  let bestSubScore = 0;
  // The taxonomy in this file only labels subs - we use simple keywords per sub
  // derived from the same parent keywords for now. A future improvement is
  // dedicated sub-keyword maps per top-level category.
  bestSub = top.sub[0];
  bestSubScore = top.score;

  return {
    category: top.label,
    category_id: top.id,
    category_sub: bestSub,
    score: top.score,
    confidence: Math.min(1, top.score / 8),
    signals: top.matched.slice(0, 12),
    runner_up: scores[1]
      ? { label: scores[1].label, score: scores[1].score }
      : null,
  };
}

module.exports = { classify, TAXONOMY };
