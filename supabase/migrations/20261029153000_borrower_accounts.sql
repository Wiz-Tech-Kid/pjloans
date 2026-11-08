-- DEPRECATED: do not apply. This migration belongs to an earlier design that
-- stored lending data in Supabase. The intended source of truth is local PostgreSQL.
create type public.borrower_type as enum ('STUDENT', 'EMPLOYED', 'UNEMPLOYED');

create table public.borrower_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  phone text not null check (length(btrim(phone)) between 7 and 24),
  borrower_type public.borrower_type not null,
  created_at timestamptz not null default now()
);

alter table public.borrower_profiles enable row level security;
revoke all on public.borrower_profiles from public, anon, authenticated;
grant select on public.borrower_profiles to authenticated;
grant update (full_name, phone) on public.borrower_profiles to authenticated;

create policy "pjloans_borrower_profiles_read_own"
on public.borrower_profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "pjloans_borrower_profiles_update_own"
on public.borrower_profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create function public.handle_new_borrower()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_type public.borrower_type;
begin
  if new.raw_user_meta_data ->> 'borrower_type' not in ('STUDENT', 'EMPLOYED', 'UNEMPLOYED') then
    raise exception 'A valid borrower type is required';
  end if;

  selected_type := (new.raw_user_meta_data ->> 'borrower_type')::public.borrower_type;

  insert into public.borrower_profiles (id, full_name, phone, borrower_type)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120),
    left(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), 24),
    selected_type
  );
  return new;
end;
$$;

revoke all on function public.handle_new_borrower() from public, anon, authenticated;

create trigger pjloans_on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_borrower();

insert into public.borrower_profiles (id, full_name, phone, borrower_type)
select
  u.id,
  btrim(u.raw_user_meta_data ->> 'full_name'),
  btrim(u.raw_user_meta_data ->> 'phone'),
  (u.raw_user_meta_data ->> 'borrower_type')::public.borrower_type
from auth.users u
where u.raw_user_meta_data ->> 'borrower_type' in ('STUDENT', 'EMPLOYED', 'UNEMPLOYED')
  and length(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', ''))) between 1 and 120
  and btrim(coalesce(u.raw_user_meta_data ->> 'phone', '')) ~ '^\+?[0-9 ()-]{7,24}$'
on conflict (id) do nothing;

create table public.borrower_applications (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.borrower_profiles(id) on delete cascade,
  borrower_type public.borrower_type not null,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  phone text not null check (length(btrim(phone)) between 7 and 24),
  national_id text not null default '',
  institution text not null default '',
  student_id text not null default '',
  employer text not null default '',
  employment_status text not null default '',
  requested_amount numeric(12, 2) not null check (requested_amount > 0),
  receiving_method text not null check (receiving_method in ('CASH', 'FNB_PAY_TO_CELL', 'EFT', 'ORANGE_MONEY', 'MYZAKA', 'SMEGA')),
  recipient_name text not null check (length(btrim(recipient_name)) between 1 and 120),
  same_as_id boolean not null default false,
  recipient_identifier text not null default '',
  current_step text not null default 'IN_PROGRESS',
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISBURSED')),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  check (current_step in ('IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISBURSED')),
  check (borrower_type <> 'STUDENT' or (length(btrim(institution)) > 0 and length(btrim(student_id)) > 0)),
  check (borrower_type <> 'EMPLOYED' or (length(btrim(employer)) > 0 and length(btrim(employment_status)) > 0))
);

create unique index borrower_applications_one_active_per_user
on public.borrower_applications (user_id)
where status in ('IN_PROGRESS', 'SUBMITTED');

alter table public.borrower_applications enable row level security;
revoke all on public.borrower_applications from public, anon, authenticated;
grant select, insert on public.borrower_applications to authenticated;
grant update (
  full_name,
  phone,
  national_id,
  institution,
  student_id,
  employer,
  employment_status,
  requested_amount,
  receiving_method,
  recipient_name,
  same_as_id,
  recipient_identifier,
  status
) on public.borrower_applications to authenticated;
grant usage, select on sequence public.borrower_applications_id_seq to authenticated;

create policy "pjloans_borrower_applications_read_own"
on public.borrower_applications for select to authenticated
using ((select auth.uid()) = user_id);

create policy "pjloans_borrower_applications_insert_own"
on public.borrower_applications for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'IN_PROGRESS'
  and exists (
    select 1
    from public.borrower_profiles p
    where p.id = (select auth.uid())
      and p.borrower_type = borrower_applications.borrower_type
  )
);

create policy "pjloans_borrower_applications_update_own"
on public.borrower_applications for update to authenticated
using ((select auth.uid()) = user_id and status = 'IN_PROGRESS')
with check (
  (select auth.uid()) = user_id
  and status in ('IN_PROGRESS', 'SUBMITTED')
  and exists (
    select 1
    from public.borrower_profiles p
    where p.id = (select auth.uid())
      and p.borrower_type = borrower_applications.borrower_type
  )
);

create table public.borrower_verification_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.borrower_profiles(id) on delete cascade,
  borrower_type public.borrower_type not null,
  document_type text not null check (document_type in ('STUDENT_ID', 'ADMISSION_LETTER', 'IDENTITY_DOCUMENT', 'EMPLOYMENT_LETTER')),
  object_path text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 180),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'REJECTED')),
  review_note text,
  created_at timestamptz not null default now(),
  check (
    split_part(object_path, '/', 1) = user_id::text
    and split_part(object_path, '/', 2) = document_type
    and split_part(object_path, '/', 3) <> ''
  )
);

create index borrower_verification_documents_owner_type_created
on public.borrower_verification_documents (user_id, document_type, created_at desc);

alter table public.borrower_verification_documents enable row level security;
revoke all on public.borrower_verification_documents from public, anon, authenticated;
grant select, insert on public.borrower_verification_documents to authenticated;

create policy "pjloans_verification_documents_read_own"
on public.borrower_verification_documents for select to authenticated
using ((select auth.uid()) = user_id);

create policy "pjloans_verification_documents_insert_matching_type"
on public.borrower_verification_documents for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'PENDING'
  and exists (
    select 1
    from public.borrower_profiles p
    where p.id = (select auth.uid())
      and p.borrower_type = borrower_verification_documents.borrower_type
      and (
        (p.borrower_type = 'STUDENT' and document_type in ('STUDENT_ID', 'ADMISSION_LETTER', 'IDENTITY_DOCUMENT'))
        or (p.borrower_type = 'EMPLOYED' and document_type in ('EMPLOYMENT_LETTER', 'IDENTITY_DOCUMENT'))
        or (p.borrower_type = 'UNEMPLOYED' and document_type = 'IDENTITY_DOCUMENT')
      )
  )
  and exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'borrower-verification'
      and o.name = object_path
      and (storage.foldername(o.name))[1] = (select auth.uid())::text
  )
);

create table public.borrower_loans (
  id bigint generated always as identity primary key,
  application_id bigint not null unique references public.borrower_applications(id) on delete cascade,
  principal numeric(12, 2) not null check (principal > 0),
  interest_rate numeric(5, 2) not null check (interest_rate >= 0),
  interest_amount numeric(12, 2) not null check (interest_amount >= 0),
  total_due numeric(12, 2) not null check (total_due >= principal),
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  outstanding_amount numeric(12, 2) not null check (outstanding_amount >= 0),
  due_date date not null,
  status text not null,
  disbursement_reference text,
  disbursed_at timestamptz
);

alter table public.borrower_loans enable row level security;
revoke all on public.borrower_loans from public, anon, authenticated;
grant select on public.borrower_loans to authenticated;

create policy "pjloans_borrower_loans_read_own"
on public.borrower_loans for select to authenticated
using (
  exists (
    select 1
    from public.borrower_applications a
    where a.id = application_id
      and a.user_id = (select auth.uid())
  )
);

create function public.enforce_borrower_application_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'SUBMITTED' and old.status = 'IN_PROGRESS' then
    if new.borrower_type = 'UNEMPLOYED' then
      raise exception 'Unemployed borrower requirements are not yet confirmed';
    end if;

    if exists (
      select required.document_type
      from unnest(
        case new.borrower_type
          when 'STUDENT'::public.borrower_type then array['STUDENT_ID', 'ADMISSION_LETTER', 'IDENTITY_DOCUMENT']
          when 'EMPLOYED'::public.borrower_type then array['EMPLOYMENT_LETTER', 'IDENTITY_DOCUMENT']
          else array['IDENTITY_DOCUMENT']
        end
      ) as required(document_type)
      where not exists (
        select 1
        from public.borrower_verification_documents d
        where d.user_id = new.user_id
          and d.document_type = required.document_type
          and d.status = 'VERIFIED'
      )
    ) then
      raise exception 'Required verification documents must be approved before submission';
    end if;

    new.current_step := 'SUBMITTED';
    new.submitted_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_borrower_application_submission() from public, anon, authenticated;

create trigger pjloans_validate_application_submission
before update of status on public.borrower_applications
for each row execute function public.enforce_borrower_application_submission();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'borrower-verification',
  'borrower-verification',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "pjloans_verification_storage_read_own" on storage.objects;
create policy "pjloans_verification_storage_read_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'borrower-verification'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.borrower_profiles p
    where p.id = (select auth.uid())
      and (
        (p.borrower_type = 'STUDENT' and (storage.foldername(name))[2] in ('STUDENT_ID', 'ADMISSION_LETTER', 'IDENTITY_DOCUMENT'))
        or (p.borrower_type = 'EMPLOYED' and (storage.foldername(name))[2] in ('EMPLOYMENT_LETTER', 'IDENTITY_DOCUMENT'))
        or (p.borrower_type = 'UNEMPLOYED' and (storage.foldername(name))[2] = 'IDENTITY_DOCUMENT')
      )
  )
);

drop policy if exists "pjloans_verification_storage_upload_matching_type" on storage.objects;
create policy "pjloans_verification_storage_upload_matching_type"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'borrower-verification'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.borrower_profiles p
    where p.id = (select auth.uid())
      and (
        (p.borrower_type = 'STUDENT' and (storage.foldername(name))[2] in ('STUDENT_ID', 'ADMISSION_LETTER', 'IDENTITY_DOCUMENT'))
        or (p.borrower_type = 'EMPLOYED' and (storage.foldername(name))[2] in ('EMPLOYMENT_LETTER', 'IDENTITY_DOCUMENT'))
        or (p.borrower_type = 'UNEMPLOYED' and (storage.foldername(name))[2] = 'IDENTITY_DOCUMENT')
      )
  )
);

drop policy if exists "pjloans_verification_storage_delete_own" on storage.objects;
create policy "pjloans_verification_storage_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'borrower-verification'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (
    select 1
    from public.borrower_verification_documents d
    where d.user_id = (select auth.uid())
      and d.object_path = name
  )
  and exists (
    select 1
    from public.borrower_profiles p
    where p.id = (select auth.uid())
      and (
        (p.borrower_type = 'STUDENT' and (storage.foldername(name))[2] in ('STUDENT_ID', 'ADMISSION_LETTER', 'IDENTITY_DOCUMENT'))
        or (p.borrower_type = 'EMPLOYED' and (storage.foldername(name))[2] in ('EMPLOYMENT_LETTER', 'IDENTITY_DOCUMENT'))
        or (p.borrower_type = 'UNEMPLOYED' and (storage.foldername(name))[2] = 'IDENTITY_DOCUMENT')
      )
  )
);
