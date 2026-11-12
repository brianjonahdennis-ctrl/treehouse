-- University chatrooms: the two main universities of each state (Abuja: UniAbuja only), 73 rooms.
-- Like state rooms, only people whose dating card is in that state can see or join them.
-- Each holds 300. Still one chatroom at a time.

create or replace function dating_private.uni_room_codes() returns text[]
language sql immutable as $$ select array['MOUAU', 'ABSU', 'MAU', 'ADSU', 'UNIUYO', 'AKSU', 'UNIZIK', 'COOU', 'ATBU', 'BASUG', 'NDU', 'FUO', 'BSU', 'JOSTUM', 'UNIMAID', 'BOSU', 'UNICAL', 'UNICROSS', 'DELSU', 'FUPRE', 'EBSU', 'AE-FUNAI', 'UNIBEN', 'AAU', 'EKSU', 'FUOYE', 'UNN', 'ESUT', 'UniAbuja', 'GSU', 'FUK', 'IMSU', 'FUTO', 'FUD', 'SLU', 'ABU', 'KASU', 'BUK', 'KUST', 'UMYU', 'FUDMA', 'KSUSTA', 'FUBK', 'PAAU', 'FULOKOJA', 'UNILORIN', 'KWASU', 'UNILAG', 'LASU', 'NSUK', 'FULAFIA', 'FUT Minna', 'IBBU', 'FUNAAB', 'OOU', 'FUTA', 'AAUA', 'OAU', 'UNIOSUN', 'UI', 'LAUTECH', 'UNIJOS', 'PLASU', 'UNIPORT', 'RSU', 'UDUS', 'SSU', 'TSU', 'FUW', 'YSU', 'FUGA', 'FUGUS', 'ZAMSUT'] $$;

create or replace function dating_private.uni_rooms_for(p_state text) returns text[]
language sql immutable as $$
  select case p_state
    when 'Abia' then array['MOUAU', 'ABSU']
    when 'Adamawa' then array['MAU', 'ADSU']
    when 'Akwa Ibom' then array['UNIUYO', 'AKSU']
    when 'Anambra' then array['UNIZIK', 'COOU']
    when 'Bauchi' then array['ATBU', 'BASUG']
    when 'Bayelsa' then array['NDU', 'FUO']
    when 'Benue' then array['BSU', 'JOSTUM']
    when 'Borno' then array['UNIMAID', 'BOSU']
    when 'Cross River' then array['UNICAL', 'UNICROSS']
    when 'Delta' then array['DELSU', 'FUPRE']
    when 'Ebonyi' then array['EBSU', 'AE-FUNAI']
    when 'Edo' then array['UNIBEN', 'AAU']
    when 'Ekiti' then array['EKSU', 'FUOYE']
    when 'Enugu' then array['UNN', 'ESUT']
    when 'FCT' then array['UniAbuja']
    when 'Gombe' then array['GSU', 'FUK']
    when 'Imo' then array['IMSU', 'FUTO']
    when 'Jigawa' then array['FUD', 'SLU']
    when 'Kaduna' then array['ABU', 'KASU']
    when 'Kano' then array['BUK', 'KUST']
    when 'Katsina' then array['UMYU', 'FUDMA']
    when 'Kebbi' then array['KSUSTA', 'FUBK']
    when 'Kogi' then array['PAAU', 'FULOKOJA']
    when 'Kwara' then array['UNILORIN', 'KWASU']
    when 'Lagos' then array['UNILAG', 'LASU']
    when 'Nasarawa' then array['NSUK', 'FULAFIA']
    when 'Niger' then array['FUT Minna', 'IBBU']
    when 'Ogun' then array['FUNAAB', 'OOU']
    when 'Ondo' then array['FUTA', 'AAUA']
    when 'Osun' then array['OAU', 'UNIOSUN']
    when 'Oyo' then array['UI', 'LAUTECH']
    when 'Plateau' then array['UNIJOS', 'PLASU']
    when 'Rivers' then array['UNIPORT', 'RSU']
    when 'Sokoto' then array['UDUS', 'SSU']
    when 'Taraba' then array['TSU', 'FUW']
    when 'Yobe' then array['YSU', 'FUGA']
    when 'Zamfara' then array['FUGUS', 'ZAMSUT']
    else '{}'::text[] end
$$;

create or replace function dating_private.uni_room_state(p_room text) returns text
language sql immutable as $$
  select case p_room
    when 'MOUAU' then 'Abia'
    when 'ABSU' then 'Abia'
    when 'MAU' then 'Adamawa'
    when 'ADSU' then 'Adamawa'
    when 'UNIUYO' then 'Akwa Ibom'
    when 'AKSU' then 'Akwa Ibom'
    when 'UNIZIK' then 'Anambra'
    when 'COOU' then 'Anambra'
    when 'ATBU' then 'Bauchi'
    when 'BASUG' then 'Bauchi'
    when 'NDU' then 'Bayelsa'
    when 'FUO' then 'Bayelsa'
    when 'BSU' then 'Benue'
    when 'JOSTUM' then 'Benue'
    when 'UNIMAID' then 'Borno'
    when 'BOSU' then 'Borno'
    when 'UNICAL' then 'Cross River'
    when 'UNICROSS' then 'Cross River'
    when 'DELSU' then 'Delta'
    when 'FUPRE' then 'Delta'
    when 'EBSU' then 'Ebonyi'
    when 'AE-FUNAI' then 'Ebonyi'
    when 'UNIBEN' then 'Edo'
    when 'AAU' then 'Edo'
    when 'EKSU' then 'Ekiti'
    when 'FUOYE' then 'Ekiti'
    when 'UNN' then 'Enugu'
    when 'ESUT' then 'Enugu'
    when 'UniAbuja' then 'FCT'
    when 'GSU' then 'Gombe'
    when 'FUK' then 'Gombe'
    when 'IMSU' then 'Imo'
    when 'FUTO' then 'Imo'
    when 'FUD' then 'Jigawa'
    when 'SLU' then 'Jigawa'
    when 'ABU' then 'Kaduna'
    when 'KASU' then 'Kaduna'
    when 'BUK' then 'Kano'
    when 'KUST' then 'Kano'
    when 'UMYU' then 'Katsina'
    when 'FUDMA' then 'Katsina'
    when 'KSUSTA' then 'Kebbi'
    when 'FUBK' then 'Kebbi'
    when 'PAAU' then 'Kogi'
    when 'FULOKOJA' then 'Kogi'
    when 'UNILORIN' then 'Kwara'
    when 'KWASU' then 'Kwara'
    when 'UNILAG' then 'Lagos'
    when 'LASU' then 'Lagos'
    when 'NSUK' then 'Nasarawa'
    when 'FULAFIA' then 'Nasarawa'
    when 'FUT Minna' then 'Niger'
    when 'IBBU' then 'Niger'
    when 'FUNAAB' then 'Ogun'
    when 'OOU' then 'Ogun'
    when 'FUTA' then 'Ondo'
    when 'AAUA' then 'Ondo'
    when 'OAU' then 'Osun'
    when 'UNIOSUN' then 'Osun'
    when 'UI' then 'Oyo'
    when 'LAUTECH' then 'Oyo'
    when 'UNIJOS' then 'Plateau'
    when 'PLASU' then 'Plateau'
    when 'UNIPORT' then 'Rivers'
    when 'RSU' then 'Rivers'
    when 'UDUS' then 'Sokoto'
    when 'SSU' then 'Sokoto'
    when 'TSU' then 'Taraba'
    when 'FUW' then 'Taraba'
    when 'YSU' then 'Yobe'
    when 'FUGA' then 'Yobe'
    when 'FUGUS' then 'Zamfara'
    when 'ZAMSUT' then 'Zamfara'
  end
$$;

create or replace function dating_private.uni_room_name(p_room text) returns text
language sql immutable as $$
  select case p_room
    when 'MOUAU' then 'Michael Okpara University of Agriculture, Umudike'
    when 'ABSU' then 'Abia State University'
    when 'MAU' then 'Modibbo Adama University, Yola'
    when 'ADSU' then 'Adamawa State University, Mubi'
    when 'UNIUYO' then 'University of Uyo'
    when 'AKSU' then 'Akwa Ibom State University'
    when 'UNIZIK' then 'Nnamdi Azikiwe University'
    when 'COOU' then 'Chukwuemeka Odumegwu Ojukwu University'
    when 'ATBU' then 'Abubakar Tafawa Balewa University'
    when 'BASUG' then 'Bauchi State University, Gadau'
    when 'NDU' then 'Niger Delta University'
    when 'FUO' then 'Federal University Otuoke'
    when 'BSU' then 'Benue State University'
    when 'JOSTUM' then 'Joseph Sarwuan Tarka University, Makurdi'
    when 'UNIMAID' then 'University of Maiduguri'
    when 'BOSU' then 'Borno State University'
    when 'UNICAL' then 'University of Calabar'
    when 'UNICROSS' then 'University of Cross River State'
    when 'DELSU' then 'Delta State University, Abraka'
    when 'FUPRE' then 'Federal University of Petroleum Resources'
    when 'EBSU' then 'Ebonyi State University'
    when 'AE-FUNAI' then 'Alex Ekwueme Federal University'
    when 'UNIBEN' then 'University of Benin'
    when 'AAU' then 'Ambrose Alli University'
    when 'EKSU' then 'Ekiti State University'
    when 'FUOYE' then 'Federal University Oye-Ekiti'
    when 'UNN' then 'University of Nigeria, Nsukka'
    when 'ESUT' then 'Enugu State University of Science and Technology'
    when 'UniAbuja' then 'University of Abuja'
    when 'GSU' then 'Gombe State University'
    when 'FUK' then 'Federal University Kashere'
    when 'IMSU' then 'Imo State University'
    when 'FUTO' then 'Federal University of Technology Owerri'
    when 'FUD' then 'Federal University Dutse'
    when 'SLU' then 'Sule Lamido University'
    when 'ABU' then 'Ahmadu Bello University, Zaria'
    when 'KASU' then 'Kaduna State University'
    when 'BUK' then 'Bayero University Kano'
    when 'KUST' then 'Aliko Dangote University of Science and Technology, Wudil'
    when 'UMYU' then 'Umaru Musa Yar''adua University'
    when 'FUDMA' then 'Federal University Dutsin-Ma'
    when 'KSUSTA' then 'Kebbi State University of Science and Technology'
    when 'FUBK' then 'Federal University Birnin Kebbi'
    when 'PAAU' then 'Prince Abubakar Audu University, Anyigba'
    when 'FULOKOJA' then 'Federal University Lokoja'
    when 'UNILORIN' then 'University of Ilorin'
    when 'KWASU' then 'Kwara State University'
    when 'UNILAG' then 'University of Lagos'
    when 'LASU' then 'Lagos State University'
    when 'NSUK' then 'Nasarawa State University, Keffi'
    when 'FULAFIA' then 'Federal University of Lafia'
    when 'FUT Minna' then 'Federal University of Technology Minna'
    when 'IBBU' then 'Ibrahim Badamasi Babangida University'
    when 'FUNAAB' then 'Federal University of Agriculture Abeokuta'
    when 'OOU' then 'Olabisi Onabanjo University'
    when 'FUTA' then 'Federal University of Technology Akure'
    when 'AAUA' then 'Adekunle Ajasin University'
    when 'OAU' then 'Obafemi Awolowo University'
    when 'UNIOSUN' then 'Osun State University'
    when 'UI' then 'University of Ibadan'
    when 'LAUTECH' then 'Ladoke Akintola University of Technology'
    when 'UNIJOS' then 'University of Jos'
    when 'PLASU' then 'Plateau State University'
    when 'UNIPORT' then 'University of Port Harcourt'
    when 'RSU' then 'Rivers State University'
    when 'UDUS' then 'Usmanu Danfodiyo University'
    when 'SSU' then 'Sokoto State University'
    when 'TSU' then 'Taraba State University'
    when 'FUW' then 'Federal University Wukari'
    when 'YSU' then 'Yobe State University'
    when 'FUGA' then 'Federal University Gashua'
    when 'FUGUS' then 'Federal University Gusau'
    when 'ZAMSUT' then 'Zamfara State University, Talata Mafara'
  end
$$;

create or replace function dating_private.room_names() returns text[]
language sql immutable as $$
  select dating_private.nigerian_states() || dating_private.general_rooms() || dating_private.uni_room_codes()
$$;

create or replace function dating_private.room_capacity(p_room text) returns int
language sql immutable as $$
  select case
    when p_room = any (dating_private.general_rooms()) then 500
    when p_room = any (dating_private.uni_room_codes()) then 300
    else 200 end
$$;

-- Your rooms: your state, its universities, then the rooms open to you.
create or replace function dating_private.my_rooms(p_user uuid) returns text[]
language sql stable security definer set search_path = public, dating_private as $$
  select coalesce((select array[p.state] || uni_rooms_for(p.state) from dating_profiles p where p.user_id = p_user and p.state is not null), '{}')
      || array(
           select r from unnest(general_rooms()) with ordinality as g(r, ord)
           where (r <> 'Ladies Room' or exists (select 1 from dating_profiles p where p.user_id = p_user and p.gender = 'female'))
             and (r <> 'Mens Room'   or exists (select 1 from dating_profiles p where p.user_id = p_user and p.gender = 'male'))
           order by ord);
$$;

create or replace function dating_private.room_denied(p_room text) returns text
language sql immutable as $$
  select case
    when p_room = 'Ladies Room' then 'The Ladies'' Room is for women only.'
    when p_room = 'Mens Room' then 'The Men''s Room is for men only.'
    when p_room = any (dating_private.uni_room_codes()) then
      'The ' || p_room || ' room is only for people in '
      || case when dating_private.uni_room_state(p_room) = 'FCT' then 'Abuja (FCT)' else dating_private.uni_room_state(p_room) || ' State' end || '.'
    when p_room = 'FCT' then 'This chatroom is only for people in Abuja (FCT). You can join your own state''s room or any room open to everyone.'
    else 'This chatroom is only for people in ' || p_room || ' State. You can join your own state''s room or any room open to everyone.'
  end
$$;

-- Changing state also leaves your old state's university rooms.
create or replace function dating_private.guard_state_change() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if tg_op = 'INSERT' then
    if new.state is not null then new.state_changed_at := now(); end if;
    return new;
  end if;
  if new.state is distinct from old.state then
    if old.state is not null and old.state_changed_at is not null and old.state_changed_at > now() - interval '30 days' then
      raise exception 'You can change your state once every 30 days. You can change it again on %.',
        to_char(old.state_changed_at + interval '30 days', 'FMDD Mon YYYY') using errcode = 'P0001';
    end if;
    new.state_changed_at := now();
    delete from room_members where user_id = new.user_id and (state = old.state or state = any (uni_rooms_for(old.state)));
  else
    new.state_changed_at := old.state_changed_at;
  end if;
  return new;
end $$;
