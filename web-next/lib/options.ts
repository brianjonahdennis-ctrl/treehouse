// Option lists shared by every screen. Copied from anon-inbox/public/hy-state.js: keep the two in step
// (STATES must match dating_private.nigerian_states() in the database).
/* eslint-disable quotes */

export const GENDERS: [string, string][] = [['female', 'Woman'], ['male', 'Man'], ['other', 'Non-binary / other']];
export const GENDER_LABEL: Record<string, string> = { female: 'Woman', male: 'Man', other: 'Non-binary' };
export const INTENTS: [string, string][] = [['fun', 'Something fun 😄'], ['friendship', 'Friendship 🤝'], ['love', 'A relationship ❤️'], ['marriage', 'Marriage 💍']];
export const INTENT_LABEL: Record<string, string> = { fun: 'Fun 😄', friendship: 'Friendship 🤝', love: 'Love ❤️', marriage: 'Marriage 💍' };
export const INTERESTS = ['Music', 'Afrobeats', 'Football', 'Movies', 'Fashion', 'Food', 'Travel', 'Gaming', 'Fitness', 'Art', 'Books', 'Tech', 'Faith', 'Photography', 'Dancing', 'Comedy', 'Business', 'Anime', 'Nature', 'Cooking'];
// Nigeria's 36 states and the FCT (must match dating_private.nigerian_states() in the database).
export const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta',
  'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
export const stateLabel = (s?: string | null) => (s === 'FCT' ? 'FCT (Abuja)' : s || 'Anywhere in Nigeria');
// Rooms open across Nigeria (the server decides who may join each one).
// Can this profile join an age room? null = not an age room. Same rule and wording as the server.
export const ageRoomBlock = (room: string, age?: number | null) => {
  const r = GENERAL_ROOMS[room]; if (!r || !r.ages || !age) return null;
  return age < r.ages[0] ? 'You are too young for this group.' : age > r.ages[1] ? 'You are too old for this group.' : null;
};
export const GENERAL_ROOMS: Record<string, { name: string; emoji: string; tag: string; blurb: string; ages?: [number, number] }> = {
  'Nigeria': { name: 'Nigeria', emoji: '🇳🇬', tag: 'Everyone', blurb: 'The whole country in one room' },
  // Age rooms: everyone sees them; only people whose profile age fits can join (the server checks).
  'Ages 18-25': { name: 'Ages 18–25', emoji: '🎓', tag: 'Ages 18–25', blurb: 'Your age group, from all over Nigeria', ages: [18, 25] },
  'Ages 26-35': { name: 'Ages 26–35', emoji: '💼', tag: 'Ages 26–35', blurb: 'Your age group, from all over Nigeria', ages: [26, 35] },
  'Ages 36+': { name: 'Ages 36+', emoji: '🌟', tag: 'Ages 36+', blurb: 'Your age group, from all over Nigeria', ages: [36, 200] },
  'Lovers Lounge': { name: 'Lover’s Lounge', emoji: '💘', tag: 'Everyone', blurb: 'Love, dating and relationship talk' },
  'Football Banter': { name: 'Football Banter', emoji: '⚽', tag: 'Everyone', blurb: 'Matches, transfers and trash talk' },
  'Christian Room': { name: 'Christian Room', emoji: '✝️', tag: 'Everyone', blurb: 'Faith, fellowship and good vibes' },
  'Muslim Room': { name: 'Muslim Room', emoji: '☪️', tag: 'Everyone', blurb: 'Faith, fellowship and good vibes' },
  'Ladies Room': { name: 'Ladies’ Room', emoji: '💅', tag: 'Women only', blurb: 'Just the girls' },
  'Mens Room': { name: 'Men’s Room', emoji: '🧔🏾', tag: 'Men only', blurb: 'Just the guys' },
};
// State landmark photos for the state room badges (filled in from Wikimedia Commons; credits at /photo-credits).
export const LANDMARKS: Record<string, string> = {};
// University rooms: two per state (Abuja: one). Only people in that state can join.
export const UNI_ROOMS: Record<string, { name: string; state: string }> = {
  "MOUAU": { name: "Michael Okpara University of Agriculture, Umudike", state: "Abia" },
  "ABSU": { name: "Abia State University", state: "Abia" },
  "MAU": { name: "Modibbo Adama University, Yola", state: "Adamawa" },
  "ADSU": { name: "Adamawa State University, Mubi", state: "Adamawa" },
  "UNIUYO": { name: "University of Uyo", state: "Akwa Ibom" },
  "AKSU": { name: "Akwa Ibom State University", state: "Akwa Ibom" },
  "UNIZIK": { name: "Nnamdi Azikiwe University", state: "Anambra" },
  "COOU": { name: "Chukwuemeka Odumegwu Ojukwu University", state: "Anambra" },
  "ATBU": { name: "Abubakar Tafawa Balewa University", state: "Bauchi" },
  "BASUG": { name: "Bauchi State University, Gadau", state: "Bauchi" },
  "NDU": { name: "Niger Delta University", state: "Bayelsa" },
  "FUO": { name: "Federal University Otuoke", state: "Bayelsa" },
  "BSU": { name: "Benue State University", state: "Benue" },
  "JOSTUM": { name: "Joseph Sarwuan Tarka University, Makurdi", state: "Benue" },
  "UNIMAID": { name: "University of Maiduguri", state: "Borno" },
  "BOSU": { name: "Borno State University", state: "Borno" },
  "UNICAL": { name: "University of Calabar", state: "Cross River" },
  "UNICROSS": { name: "University of Cross River State", state: "Cross River" },
  "DELSU": { name: "Delta State University, Abraka", state: "Delta" },
  "FUPRE": { name: "Federal University of Petroleum Resources", state: "Delta" },
  "EBSU": { name: "Ebonyi State University", state: "Ebonyi" },
  "AE-FUNAI": { name: "Alex Ekwueme Federal University", state: "Ebonyi" },
  "UNIBEN": { name: "University of Benin", state: "Edo" },
  "AAU": { name: "Ambrose Alli University", state: "Edo" },
  "EKSU": { name: "Ekiti State University", state: "Ekiti" },
  "FUOYE": { name: "Federal University Oye-Ekiti", state: "Ekiti" },
  "UNN": { name: "University of Nigeria, Nsukka", state: "Enugu" },
  "ESUT": { name: "Enugu State University of Science and Technology", state: "Enugu" },
  "UniAbuja": { name: "University of Abuja", state: "FCT" },
  "GSU": { name: "Gombe State University", state: "Gombe" },
  "FUK": { name: "Federal University Kashere", state: "Gombe" },
  "IMSU": { name: "Imo State University", state: "Imo" },
  "FUTO": { name: "Federal University of Technology Owerri", state: "Imo" },
  "FUD": { name: "Federal University Dutse", state: "Jigawa" },
  "SLU": { name: "Sule Lamido University", state: "Jigawa" },
  "ABU": { name: "Ahmadu Bello University, Zaria", state: "Kaduna" },
  "KASU": { name: "Kaduna State University", state: "Kaduna" },
  "BUK": { name: "Bayero University Kano", state: "Kano" },
  "KUST": { name: "Aliko Dangote University of Science and Technology, Wudil", state: "Kano" },
  "UMYU": { name: "Umaru Musa Yar'adua University", state: "Katsina" },
  "FUDMA": { name: "Federal University Dutsin-Ma", state: "Katsina" },
  "KSUSTA": { name: "Kebbi State University of Science and Technology", state: "Kebbi" },
  "FUBK": { name: "Federal University Birnin Kebbi", state: "Kebbi" },
  "PAAU": { name: "Prince Abubakar Audu University, Anyigba", state: "Kogi" },
  "FULOKOJA": { name: "Federal University Lokoja", state: "Kogi" },
  "UNILORIN": { name: "University of Ilorin", state: "Kwara" },
  "KWASU": { name: "Kwara State University", state: "Kwara" },
  "UNILAG": { name: "University of Lagos", state: "Lagos" },
  "LASU": { name: "Lagos State University", state: "Lagos" },
  "NSUK": { name: "Nasarawa State University, Keffi", state: "Nasarawa" },
  "FULAFIA": { name: "Federal University of Lafia", state: "Nasarawa" },
  "FUT Minna": { name: "Federal University of Technology Minna", state: "Niger" },
  "IBBU": { name: "Ibrahim Badamasi Babangida University", state: "Niger" },
  "FUNAAB": { name: "Federal University of Agriculture Abeokuta", state: "Ogun" },
  "OOU": { name: "Olabisi Onabanjo University", state: "Ogun" },
  "FUTA": { name: "Federal University of Technology Akure", state: "Ondo" },
  "AAUA": { name: "Adekunle Ajasin University", state: "Ondo" },
  "OAU": { name: "Obafemi Awolowo University", state: "Osun" },
  "UNIOSUN": { name: "Osun State University", state: "Osun" },
  "UI": { name: "University of Ibadan", state: "Oyo" },
  "LAUTECH": { name: "Ladoke Akintola University of Technology", state: "Oyo" },
  "UNIJOS": { name: "University of Jos", state: "Plateau" },
  "PLASU": { name: "Plateau State University", state: "Plateau" },
  "UNIPORT": { name: "University of Port Harcourt", state: "Rivers" },
  "RSU": { name: "Rivers State University", state: "Rivers" },
  "UDUS": { name: "Usmanu Danfodiyo University", state: "Sokoto" },
  "SSU": { name: "Sokoto State University", state: "Sokoto" },
  "TSU": { name: "Taraba State University", state: "Taraba" },
  "FUW": { name: "Federal University Wukari", state: "Taraba" },
  "YSU": { name: "Yobe State University", state: "Yobe" },
  "FUGA": { name: "Federal University Gashua", state: "Yobe" },
  "FUGUS": { name: "Federal University Gusau", state: "Zamfara" },
  "ZAMSUT": { name: "Zamfara State University, Talata Mafara", state: "Zamfara" },
};
export const roomName = (s: string) => (GENERAL_ROOMS[s] ? GENERAL_ROOMS[s].name : UNI_ROOMS[s] ? s : s === 'FCT' ? 'Abuja (FCT)' : `${stateLabel(s)} State`);
