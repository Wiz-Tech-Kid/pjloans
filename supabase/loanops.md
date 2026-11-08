# PJLoans local PostgreSQL schema inventory

> Generated locally from database `loanops`. This is a structural export only: it contains schema definitions and metadata, **not borrower/application row data** and not database passwords. Do not execute the DDL section against Supabase without reviewing and adapting it first.

- Generated at: `2026-10-30T03:25:18+02:00`
- Connection target: `localhost:5432`
- Database user: `loan_app`
- Database: `loanops`

## 1. Database overview and settings

```text
DATABASE OVERVIEW
 database_name | connected_as | server_address | server_port |    server_version    | database_size 
---------------+--------------+----------------+-------------+----------------------+---------------
 loanops       | loan_app     | ::1            |        5432 | 18.6 (Debian 18.6-3) | 8494 kB
(1 row)


DATABASE ATTRIBUTES
 database_name |  owner   | encoding |  collation  | character_type | connection_limit | allow_connections | access_control_list 
---------------+----------+----------+-------------+----------------+------------------+-------------------+---------------------
 loanops       | loan_app | UTF8     | en_BW.UTF-8 | en_BW.UTF-8    |               -1 | t                 | 
(1 row)


DATABASE / ROLE OVERRIDES (if configured)
 role_name | database_name | setting 
-----------+---------------+---------
(0 rows)


NON-SYSTEM SCHEMAS
 schema_name |       owner       |                      access_control_list                      
-------------+-------------------+---------------------------------------------------------------
 public      | pg_database_owner | {pg_database_owner=UC/pg_database_owner,=U/pg_database_owner}
(1 row)


```

## 2. Extensions

```text
 extension_name | version |   schema   
----------------+---------+------------
 plpgsql        | 1.0     | pg_catalog
(1 row)


```

## 3. Tables, views, sequences and row-level security

```text
 schema_name |         object_name          | object_type |  owner   | estimated_rows | total_size | rls_enabled | force_rls 
-------------+------------------------------+-------------+----------+----------------+------------+-------------+-----------
 public      | application_number_seq       | sequence    | loan_app |              1 | 8192 bytes | f           | f
 public      | applications_id_seq          | sequence    | loan_app |              1 | 8192 bytes | f           | f
 public      | audit_events_id_seq          | sequence    | loan_app |              1 | 8192 bytes | f           | f
 public      | communications_id_seq        | sequence    | loan_app |              1 | 8192 bytes | f           | f
 public      | conversation_sessions_id_seq | sequence    | loan_app |              1 | 8192 bytes | f           | f
 public      | document_extractions_id_seq  | sequence    | loan_app |              1 | 8192 bytes | f           | f
 public      | documents_id_seq             | sequence    | loan_app |              1 | 8192 bytes | f           | f
 public      | loans_id_seq                 | sequence    | loan_app |              1 | 8192 bytes | f           | f
 public      | payments_id_seq              | sequence    | loan_app |              1 | 8192 bytes | f           | f
 public      | reminders_id_seq             | sequence    | loan_app |              1 | 8192 bytes | f           | f
 public      | applications                 | table       | loan_app |             -1 | 48 kB      | f           | f
 public      | audit_events                 | table       | loan_app |             -1 | 24 kB      | f           | f
 public      | communications               | table       | loan_app |             -1 | 24 kB      | f           | f
 public      | conversation_sessions        | table       | loan_app |             -1 | 16 kB      | f           | f
 public      | customers                    | table       | loan_app |             -1 | 16 kB      | f           | f
 public      | document_extractions         | table       | loan_app |             -1 | 32 kB      | f           | f
 public      | documents                    | table       | loan_app |             -1 | 32 kB      | f           | f
 public      | loans                        | table       | loan_app |             -1 | 40 kB      | f           | f
 public      | payments                     | table       | loan_app |             -1 | 32 kB      | f           | f
 public      | reminders                    | table       | loan_app |             -1 | 16 kB      | f           | f
(20 rows)


```

## 4. Columns and column defaults

```text
 table_schema |      table_name       | ordinal_position |        column_name        |        data_type         | udt_schema |  udt_name   | is_nullable |                                      column_default                                       | is_identity | identity_generation | is_generated | generation_expression 
--------------+-----------------------+------------------+---------------------------+--------------------------+------------+-------------+-------------+-------------------------------------------------------------------------------------------+-------------+---------------------+--------------+-----------------------
 public       | applications          |                1 | id                        | bigint                   | pg_catalog | int8        | NO          |                                                                                           | YES         | ALWAYS              | NEVER        | 
 public       | applications          |                2 | application_number        | character varying        | pg_catalog | varchar     | NO          | ('APP-'::text || lpad((nextval('application_number_seq'::regclass))::text, 6, '0'::text)) | NO          |                     | NEVER        | 
 public       | applications          |                3 | customer_id               | uuid                     | pg_catalog | uuid        | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |                4 | borrower_type             | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |                5 | requested_amount          | numeric                  | pg_catalog | numeric     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |                6 | current_step              | character varying        | pg_catalog | varchar     | NO          | 'BORROWER_TYPE'::character varying                                                        | NO          |                     | NEVER        | 
 public       | applications          |                7 | status                    | character varying        | pg_catalog | varchar     | NO          | 'IN_PROGRESS'::character varying                                                          | NO          |                     | NEVER        | 
 public       | applications          |                8 | institution               | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |                9 | student_id                | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |               10 | employment_status         | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |               11 | employer                  | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |               12 | reception_method          | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |               13 | reception_name            | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |               14 | reception_name_same_as_id | boolean                  | pg_catalog | bool        | NO          | false                                                                                     | NO          |                     | NEVER        | 
 public       | applications          |               15 | reception_identifier      | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |               16 | submitted_at              | timestamp with time zone | pg_catalog | timestamptz | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |               17 | reviewed_at               | timestamp with time zone | pg_catalog | timestamptz | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |               18 | reviewed_by               | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |               19 | rejection_reason          | text                     | pg_catalog | text        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | applications          |               20 | created_at                | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | applications          |               21 | updated_at                | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | applications          |               22 | approved_amount           | numeric                  | pg_catalog | numeric     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | audit_events          |                1 | id                        | bigint                   | pg_catalog | int8        | NO          |                                                                                           | YES         | ALWAYS              | NEVER        | 
 public       | audit_events          |                2 | entity_type               | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | audit_events          |                3 | entity_id                 | bigint                   | pg_catalog | int8        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | audit_events          |                4 | event_type                | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | audit_events          |                5 | actor_type                | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | audit_events          |                6 | actor_id                  | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | audit_events          |                7 | metadata                  | jsonb                    | pg_catalog | jsonb       | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | audit_events          |                8 | created_at                | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | communications        |                1 | id                        | bigint                   | pg_catalog | int8        | NO          |                                                                                           | YES         | ALWAYS              | NEVER        | 
 public       | communications        |                2 | customer_id               | uuid                     | pg_catalog | uuid        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | communications        |                3 | application_id            | bigint                   | pg_catalog | int8        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | communications        |                4 | loan_id                   | bigint                   | pg_catalog | int8        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | communications        |                5 | direction                 | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | communications        |                6 | channel                   | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | communications        |                7 | message_type              | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | communications        |                8 | provider_message_id       | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | communications        |                9 | message_text              | text                     | pg_catalog | text        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | communications        |               10 | created_at                | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | conversation_sessions |                1 | id                        | bigint                   | pg_catalog | int8        | NO          |                                                                                           | YES         | ALWAYS              | NEVER        | 
 public       | conversation_sessions |                2 | customer_id               | uuid                     | pg_catalog | uuid        | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | conversation_sessions |                3 | current_step              | character varying        | pg_catalog | varchar     | NO          | 'BORROWER_TYPE'::character varying                                                        | NO          |                     | NEVER        | 
 public       | conversation_sessions |                4 | borrower_type             | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | conversation_sessions |                5 | requested_amount          | numeric                  | pg_catalog | numeric     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | conversation_sessions |                6 | status                    | character varying        | pg_catalog | varchar     | NO          | 'ACTIVE'::character varying                                                               | NO          |                     | NEVER        | 
 public       | conversation_sessions |                7 | created_at                | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | conversation_sessions |                8 | updated_at                | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | conversation_sessions |                9 | expires_at                | timestamp with time zone | pg_catalog | timestamptz | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | customers             |                1 | id                        | uuid                     | pg_catalog | uuid        | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | customers             |                2 | phone                     | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | customers             |                3 | full_name                 | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | customers             |                4 | national_id               | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | customers             |                5 | borrower_type             | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | customers             |                6 | created_at                | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | customers             |                7 | updated_at                | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | document_extractions  |                1 | id                        | bigint                   | pg_catalog | int8        | NO          |                                                                                           | YES         | ALWAYS              | NEVER        | 
 public       | document_extractions  |                2 | document_id               | bigint                   | pg_catalog | int8        | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | document_extractions  |                3 | extraction_engine         | character varying        | pg_catalog | varchar     | NO          | 'tesseract'::character varying                                                            | NO          |                     | NEVER        | 
 public       | document_extractions  |                4 | field_name                | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | document_extractions  |                5 | extracted_value           | text                     | pg_catalog | text        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | document_extractions  |                6 | confidence                | numeric                  | pg_catalog | numeric     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | document_extractions  |                7 | review_status             | character varying        | pg_catalog | varchar     | NO          | 'PENDING'::character varying                                                              | NO          |                     | NEVER        | 
 public       | document_extractions  |                8 | reviewed_value            | text                     | pg_catalog | text        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | document_extractions  |                9 | reviewed_by               | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | document_extractions  |               10 | reviewed_at               | timestamp with time zone | pg_catalog | timestamptz | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | document_extractions  |               11 | created_at                | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | documents             |                1 | id                        | bigint                   | pg_catalog | int8        | NO          |                                                                                           | YES         | ALWAYS              | NEVER        | 
 public       | documents             |                2 | application_id            | bigint                   | pg_catalog | int8        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |                3 | loan_id                   | bigint                   | pg_catalog | int8        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |                4 | payment_id                | bigint                   | pg_catalog | int8        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |                5 | document_type             | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |                6 | original_filename         | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |                7 | mime_type                 | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |                8 | storage_provider          | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |                9 | storage_key               | text                     | pg_catalog | text        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |               10 | whatsapp_media_id         | text                     | pg_catalog | text        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |               11 | sha256                    | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |               12 | verification_status       | character varying        | pg_catalog | varchar     | NO          | 'PENDING'::character varying                                                              | NO          |                     | NEVER        | 
 public       | documents             |               13 | uploaded_at               | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | documents             |               14 | verified_at               | timestamp with time zone | pg_catalog | timestamptz | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |               15 | verified_by               | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |               16 | reviewed_at               | timestamp with time zone | pg_catalog | timestamptz | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | documents             |               17 | review_note               | text                     | pg_catalog | text        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |                1 | id                        | bigint                   | pg_catalog | int8        | NO          |                                                                                           | YES         | ALWAYS              | NEVER        | 
 public       | loans                 |                2 | application_id            | bigint                   | pg_catalog | int8        | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |                3 | principal                 | numeric                  | pg_catalog | numeric     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |                4 | total_due                 | numeric                  | pg_catalog | numeric     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |                5 | amount_paid               | numeric                  | pg_catalog | numeric     | NO          | 0                                                                                         | NO          |                     | NEVER        | 
 public       | loans                 |                6 | outstanding_amount        | numeric                  | pg_catalog | numeric     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |                7 | due_date                  | date                     | pg_catalog | date        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |                8 | status                    | character varying        | pg_catalog | varchar     | NO          | 'APPROVED'::character varying                                                             | NO          |                     | NEVER        | 
 public       | loans                 |                9 | disbursement_method       | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |               10 | disbursement_reference    | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |               11 | approved_at               | timestamp with time zone | pg_catalog | timestamptz | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |               12 | disbursed_at              | timestamp with time zone | pg_catalog | timestamptz | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |               13 | closed_at                 | timestamp with time zone | pg_catalog | timestamptz | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |               14 | created_at                | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | loans                 |               15 | interest_rate             | numeric                  | pg_catalog | numeric     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |               16 | interest_amount           | numeric                  | pg_catalog | numeric     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | loans                 |               17 | disbursed_by              | text                     | pg_catalog | text        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | payments              |                1 | id                        | bigint                   | pg_catalog | int8        | NO          |                                                                                           | YES         | ALWAYS              | NEVER        | 
 public       | payments              |                2 | loan_id                   | bigint                   | pg_catalog | int8        | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | payments              |                3 | amount                    | numeric                  | pg_catalog | numeric     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | payments              |                4 | payment_method            | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | payments              |                5 | payment_reference         | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | payments              |                6 | status                    | character varying        | pg_catalog | varchar     | NO          | 'PENDING'::character varying                                                              | NO          |                     | NEVER        | 
 public       | payments              |                7 | rejection_reason          | text                     | pg_catalog | text        | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | payments              |                8 | submitted_at              | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
 public       | payments              |                9 | verified_at               | timestamp with time zone | pg_catalog | timestamptz | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | payments              |               10 | verified_by               | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | reminders             |                1 | id                        | bigint                   | pg_catalog | int8        | NO          |                                                                                           | YES         | ALWAYS              | NEVER        | 
 public       | reminders             |                2 | customer_id               | uuid                     | pg_catalog | uuid        | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | reminders             |                3 | loan_id                   | bigint                   | pg_catalog | int8        | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | reminders             |                4 | reminder_type             | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | reminders             |                5 | reminder_period           | character varying        | pg_catalog | varchar     | NO          |                                                                                           | NO          |                     | NEVER        | 
 public       | reminders             |                6 | provider_message_id       | character varying        | pg_catalog | varchar     | YES         |                                                                                           | NO          |                     | NEVER        | 
 public       | reminders             |                7 | sent_at                   | timestamp with time zone | pg_catalog | timestamptz | NO          | now()                                                                                     | NO          |                     | NEVER        | 
(118 rows)


```

## 5. Primary keys, foreign keys, unique/check constraints and other constraints

```text
 schema_name |      table_name       |                   constraint_name                   | constraint_type |                                                                                  definition                                                                                   | validated 
-------------+-----------------------+-----------------------------------------------------+-----------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+-----------
 public      | applications          | applications_approved_amount_positive               | CHECK           | CHECK (approved_amount IS NULL OR approved_amount > 0::numeric)                                                                                                               | t
 public      | applications          | applications_customer_id_fkey                       | FOREIGN KEY     | FOREIGN KEY (customer_id) REFERENCES customers(id)                                                                                                                            | t
 public      | applications          | applications_application_number_not_null            | NOT NULL        | NOT NULL application_number                                                                                                                                                   | t
 public      | applications          | applications_borrower_type_not_null                 | NOT NULL        | NOT NULL borrower_type                                                                                                                                                        | t
 public      | applications          | applications_created_at_not_null                    | NOT NULL        | NOT NULL created_at                                                                                                                                                           | t
 public      | applications          | applications_current_step_not_null                  | NOT NULL        | NOT NULL current_step                                                                                                                                                         | t
 public      | applications          | applications_customer_id_not_null                   | NOT NULL        | NOT NULL customer_id                                                                                                                                                          | t
 public      | applications          | applications_id_not_null                            | NOT NULL        | NOT NULL id                                                                                                                                                                   | t
 public      | applications          | applications_reception_name_same_as_id_not_null     | NOT NULL        | NOT NULL reception_name_same_as_id                                                                                                                                            | t
 public      | applications          | applications_requested_amount_not_null              | NOT NULL        | NOT NULL requested_amount                                                                                                                                                     | t
 public      | applications          | applications_status_not_null                        | NOT NULL        | NOT NULL status                                                                                                                                                               | t
 public      | applications          | applications_updated_at_not_null                    | NOT NULL        | NOT NULL updated_at                                                                                                                                                           | t
 public      | applications          | applications_pkey                                   | PRIMARY KEY     | PRIMARY KEY (id)                                                                                                                                                              | t
 public      | applications          | applications_application_number_key                 | UNIQUE          | UNIQUE (application_number)                                                                                                                                                   | t
 public      | audit_events          | audit_events_actor_type_not_null                    | NOT NULL        | NOT NULL actor_type                                                                                                                                                           | t
 public      | audit_events          | audit_events_created_at_not_null                    | NOT NULL        | NOT NULL created_at                                                                                                                                                           | t
 public      | audit_events          | audit_events_entity_type_not_null                   | NOT NULL        | NOT NULL entity_type                                                                                                                                                          | t
 public      | audit_events          | audit_events_event_type_not_null                    | NOT NULL        | NOT NULL event_type                                                                                                                                                           | t
 public      | audit_events          | audit_events_id_not_null                            | NOT NULL        | NOT NULL id                                                                                                                                                                   | t
 public      | audit_events          | audit_events_pkey                                   | PRIMARY KEY     | PRIMARY KEY (id)                                                                                                                                                              | t
 public      | communications        | communications_application_id_fkey                  | FOREIGN KEY     | FOREIGN KEY (application_id) REFERENCES applications(id)                                                                                                                      | t
 public      | communications        | communications_customer_id_fkey                     | FOREIGN KEY     | FOREIGN KEY (customer_id) REFERENCES customers(id)                                                                                                                            | t
 public      | communications        | communications_loan_id_fkey                         | FOREIGN KEY     | FOREIGN KEY (loan_id) REFERENCES loans(id)                                                                                                                                    | t
 public      | communications        | communications_channel_not_null                     | NOT NULL        | NOT NULL channel                                                                                                                                                              | t
 public      | communications        | communications_created_at_not_null                  | NOT NULL        | NOT NULL created_at                                                                                                                                                           | t
 public      | communications        | communications_direction_not_null                   | NOT NULL        | NOT NULL direction                                                                                                                                                            | t
 public      | communications        | communications_id_not_null                          | NOT NULL        | NOT NULL id                                                                                                                                                                   | t
 public      | communications        | communications_pkey                                 | PRIMARY KEY     | PRIMARY KEY (id)                                                                                                                                                              | t
 public      | conversation_sessions | valid_session_amount                                | CHECK           | CHECK (requested_amount IS NULL OR requested_amount > 0::numeric)                                                                                                             | t
 public      | conversation_sessions | valid_session_borrower_type                         | CHECK           | CHECK (borrower_type IS NULL OR (borrower_type::text = ANY (ARRAY['STUDENT'::character varying, 'EMPLOYED'::character varying, 'UNEMPLOYED'::character varying]::text[])))    | t
 public      | conversation_sessions | valid_session_status                                | CHECK           | CHECK (status::text = ANY (ARRAY['ACTIVE'::character varying, 'COMPLETED'::character varying, 'CANCELLED'::character varying, 'EXPIRED'::character varying]::text[]))         | t
 public      | conversation_sessions | conversation_sessions_customer_id_fkey              | FOREIGN KEY     | FOREIGN KEY (customer_id) REFERENCES customers(id)                                                                                                                            | t
 public      | conversation_sessions | conversation_sessions_created_at_not_null           | NOT NULL        | NOT NULL created_at                                                                                                                                                           | t
 public      | conversation_sessions | conversation_sessions_current_step_not_null         | NOT NULL        | NOT NULL current_step                                                                                                                                                         | t
 public      | conversation_sessions | conversation_sessions_customer_id_not_null          | NOT NULL        | NOT NULL customer_id                                                                                                                                                          | t
 public      | conversation_sessions | conversation_sessions_id_not_null                   | NOT NULL        | NOT NULL id                                                                                                                                                                   | t
 public      | conversation_sessions | conversation_sessions_status_not_null               | NOT NULL        | NOT NULL status                                                                                                                                                               | t
 public      | conversation_sessions | conversation_sessions_updated_at_not_null           | NOT NULL        | NOT NULL updated_at                                                                                                                                                           | t
 public      | conversation_sessions | conversation_sessions_pkey                          | PRIMARY KEY     | PRIMARY KEY (id)                                                                                                                                                              | t
 public      | customers             | customers_created_at_not_null                       | NOT NULL        | NOT NULL created_at                                                                                                                                                           | t
 public      | customers             | customers_id_not_null                               | NOT NULL        | NOT NULL id                                                                                                                                                                   | t
 public      | customers             | customers_phone_not_null                            | NOT NULL        | NOT NULL phone                                                                                                                                                                | t
 public      | customers             | customers_updated_at_not_null                       | NOT NULL        | NOT NULL updated_at                                                                                                                                                           | t
 public      | customers             | customers_pkey                                      | PRIMARY KEY     | PRIMARY KEY (id)                                                                                                                                                              | t
 public      | customers             | customers_phone_key                                 | UNIQUE          | UNIQUE (phone)                                                                                                                                                                | t
 public      | document_extractions  | valid_ocr_confidence                                | CHECK           | CHECK (confidence IS NULL OR confidence >= 0::numeric AND confidence <= 100::numeric)                                                                                         | t
 public      | document_extractions  | valid_ocr_review_status                             | CHECK           | CHECK (review_status::text = ANY (ARRAY['PENDING'::character varying, 'ACCEPTED'::character varying, 'CORRECTED'::character varying, 'REJECTED'::character varying]::text[])) | t
 public      | document_extractions  | document_extractions_document_id_fkey               | FOREIGN KEY     | FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE                                                                                                          | t
 public      | document_extractions  | document_extractions_created_at_not_null            | NOT NULL        | NOT NULL created_at                                                                                                                                                           | t
 public      | document_extractions  | document_extractions_document_id_not_null           | NOT NULL        | NOT NULL document_id                                                                                                                                                          | t
 public      | document_extractions  | document_extractions_extraction_engine_not_null     | NOT NULL        | NOT NULL extraction_engine                                                                                                                                                    | t
 public      | document_extractions  | document_extractions_field_name_not_null            | NOT NULL        | NOT NULL field_name                                                                                                                                                           | t
 public      | document_extractions  | document_extractions_id_not_null                    | NOT NULL        | NOT NULL id                                                                                                                                                                   | t
 public      | document_extractions  | document_extractions_review_status_not_null         | NOT NULL        | NOT NULL review_status                                                                                                                                                        | t
 public      | document_extractions  | document_extractions_pkey                           | PRIMARY KEY     | PRIMARY KEY (id)                                                                                                                                                              | t
 public      | documents             | documents_one_parent                                | CHECK           | CHECK (num_nonnulls(application_id, loan_id, payment_id) = 1)                                                                                                                 | t
 public      | documents             | documents_application_id_fkey                       | FOREIGN KEY     | FOREIGN KEY (application_id) REFERENCES applications(id)                                                                                                                      | t
 public      | documents             | documents_loan_id_fkey                              | FOREIGN KEY     | FOREIGN KEY (loan_id) REFERENCES loans(id)                                                                                                                                    | t
 public      | documents             | documents_payment_id_fkey                           | FOREIGN KEY     | FOREIGN KEY (payment_id) REFERENCES payments(id)                                                                                                                              | t
 public      | documents             | documents_document_type_not_null                    | NOT NULL        | NOT NULL document_type                                                                                                                                                        | t
 public      | documents             | documents_id_not_null                               | NOT NULL        | NOT NULL id                                                                                                                                                                   | t
 public      | documents             | documents_mime_type_not_null                        | NOT NULL        | NOT NULL mime_type                                                                                                                                                            | t
 public      | documents             | documents_original_filename_not_null                | NOT NULL        | NOT NULL original_filename                                                                                                                                                    | t
 public      | documents             | documents_uploaded_at_not_null                      | NOT NULL        | NOT NULL uploaded_at                                                                                                                                                          | t
 public      | documents             | documents_verification_status_not_null              | NOT NULL        | NOT NULL verification_status                                                                                                                                                  | t
 public      | documents             | documents_pkey                                      | PRIMARY KEY     | PRIMARY KEY (id)                                                                                                                                                              | t
 public      | loans                 | loans_interest_amount_nonnegative                   | CHECK           | CHECK (interest_amount IS NULL OR interest_amount >= 0::numeric)                                                                                                              | t
 public      | loans                 | loans_interest_rate_valid                           | CHECK           | CHECK (interest_rate IS NULL OR interest_rate >= 0::numeric AND interest_rate <= 100::numeric)                                                                                | t
 public      | loans                 | loans_application_id_fkey                           | FOREIGN KEY     | FOREIGN KEY (application_id) REFERENCES applications(id)                                                                                                                      | t
 public      | loans                 | loans_amount_paid_not_null                          | NOT NULL        | NOT NULL amount_paid                                                                                                                                                          | t
 public      | loans                 | loans_application_id_not_null                       | NOT NULL        | NOT NULL application_id                                                                                                                                                       | t
 public      | loans                 | loans_created_at_not_null                           | NOT NULL        | NOT NULL created_at                                                                                                                                                           | t
 public      | loans                 | loans_id_not_null                                   | NOT NULL        | NOT NULL id                                                                                                                                                                   | t
 public      | loans                 | loans_outstanding_amount_not_null                   | NOT NULL        | NOT NULL outstanding_amount                                                                                                                                                   | t
 public      | loans                 | loans_principal_not_null                            | NOT NULL        | NOT NULL principal                                                                                                                                                            | t
 public      | loans                 | loans_status_not_null                               | NOT NULL        | NOT NULL status                                                                                                                                                               | t
 public      | loans                 | loans_total_due_not_null                            | NOT NULL        | NOT NULL total_due                                                                                                                                                            | t
 public      | loans                 | loans_pkey                                          | PRIMARY KEY     | PRIMARY KEY (id)                                                                                                                                                              | t
 public      | loans                 | loans_application_id_key                            | UNIQUE          | UNIQUE (application_id)                                                                                                                                                       | t
 public      | payments              | payments_loan_id_fkey                               | FOREIGN KEY     | FOREIGN KEY (loan_id) REFERENCES loans(id)                                                                                                                                    | t
 public      | payments              | payments_amount_not_null                            | NOT NULL        | NOT NULL amount                                                                                                                                                               | t
 public      | payments              | payments_id_not_null                                | NOT NULL        | NOT NULL id                                                                                                                                                                   | t
 public      | payments              | payments_loan_id_not_null                           | NOT NULL        | NOT NULL loan_id                                                                                                                                                              | t
 public      | payments              | payments_status_not_null                            | NOT NULL        | NOT NULL status                                                                                                                                                               | t
 public      | payments              | payments_submitted_at_not_null                      | NOT NULL        | NOT NULL submitted_at                                                                                                                                                         | t
 public      | payments              | payments_pkey                                       | PRIMARY KEY     | PRIMARY KEY (id)                                                                                                                                                              | t
 public      | reminders             | reminders_customer_id_fkey                          | FOREIGN KEY     | FOREIGN KEY (customer_id) REFERENCES customers(id)                                                                                                                            | t
 public      | reminders             | reminders_loan_id_fkey                              | FOREIGN KEY     | FOREIGN KEY (loan_id) REFERENCES loans(id)                                                                                                                                    | t
 public      | reminders             | reminders_customer_id_not_null                      | NOT NULL        | NOT NULL customer_id                                                                                                                                                          | t
 public      | reminders             | reminders_id_not_null                               | NOT NULL        | NOT NULL id                                                                                                                                                                   | t
 public      | reminders             | reminders_loan_id_not_null                          | NOT NULL        | NOT NULL loan_id                                                                                                                                                              | t
 public      | reminders             | reminders_reminder_period_not_null                  | NOT NULL        | NOT NULL reminder_period                                                                                                                                                      | t
 public      | reminders             | reminders_reminder_type_not_null                    | NOT NULL        | NOT NULL reminder_type                                                                                                                                                        | t
 public      | reminders             | reminders_sent_at_not_null                          | NOT NULL        | NOT NULL sent_at                                                                                                                                                              | t
 public      | reminders             | reminders_pkey                                      | PRIMARY KEY     | PRIMARY KEY (id)                                                                                                                                                              | t
 public      | reminders             | reminders_loan_id_reminder_type_reminder_period_key | UNIQUE          | UNIQUE (loan_id, reminder_type, reminder_period)                                                                                                                              | t
(96 rows)


```

## 6. Indexes

```text
 schema_name |      table_name       |                     index_name                      |                                                                                                             definition                                                                                                              
-------------+-----------------------+-----------------------------------------------------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 public      | applications          | applications_application_number_key                 | CREATE UNIQUE INDEX applications_application_number_key ON public.applications USING btree (application_number)
 public      | applications          | applications_pkey                                   | CREATE UNIQUE INDEX applications_pkey ON public.applications USING btree (id)
 public      | applications          | idx_applications_customer                           | CREATE INDEX idx_applications_customer ON public.applications USING btree (customer_id)
 public      | applications          | idx_applications_status                             | CREATE INDEX idx_applications_status ON public.applications USING btree (status)
 public      | applications          | uq_applications_one_active_per_customer             | CREATE UNIQUE INDEX uq_applications_one_active_per_customer ON public.applications USING btree (customer_id) WHERE ((status)::text = ANY (ARRAY[('IN_PROGRESS'::character varying)::text, ('SUBMITTED'::character varying)::text]))
 public      | audit_events          | audit_events_pkey                                   | CREATE UNIQUE INDEX audit_events_pkey ON public.audit_events USING btree (id)
 public      | audit_events          | idx_audit_entity                                    | CREATE INDEX idx_audit_entity ON public.audit_events USING btree (entity_type, entity_id)
 public      | communications        | communications_pkey                                 | CREATE UNIQUE INDEX communications_pkey ON public.communications USING btree (id)
 public      | communications        | idx_communications_customer                         | CREATE INDEX idx_communications_customer ON public.communications USING btree (customer_id)
 public      | conversation_sessions | conversation_sessions_pkey                          | CREATE UNIQUE INDEX conversation_sessions_pkey ON public.conversation_sessions USING btree (id)
 public      | conversation_sessions | idx_one_active_session_per_customer                 | CREATE UNIQUE INDEX idx_one_active_session_per_customer ON public.conversation_sessions USING btree (customer_id) WHERE ((status)::text = 'ACTIVE'::text)
 public      | customers             | customers_phone_key                                 | CREATE UNIQUE INDEX customers_phone_key ON public.customers USING btree (phone)
 public      | customers             | customers_pkey                                      | CREATE UNIQUE INDEX customers_pkey ON public.customers USING btree (id)
 public      | document_extractions  | document_extractions_pkey                           | CREATE UNIQUE INDEX document_extractions_pkey ON public.document_extractions USING btree (id)
 public      | document_extractions  | idx_extractions_document                            | CREATE INDEX idx_extractions_document ON public.document_extractions USING btree (document_id)
 public      | document_extractions  | idx_extractions_review_status                       | CREATE INDEX idx_extractions_review_status ON public.document_extractions USING btree (review_status)
 public      | documents             | documents_pkey                                      | CREATE UNIQUE INDEX documents_pkey ON public.documents USING btree (id)
 public      | documents             | idx_documents_application                           | CREATE INDEX idx_documents_application ON public.documents USING btree (application_id)
 public      | documents             | idx_documents_payment                               | CREATE INDEX idx_documents_payment ON public.documents USING btree (payment_id)
 public      | loans                 | idx_loans_status_due                                | CREATE INDEX idx_loans_status_due ON public.loans USING btree (status, due_date)
 public      | loans                 | loans_application_id_key                            | CREATE UNIQUE INDEX loans_application_id_key ON public.loans USING btree (application_id)
 public      | loans                 | loans_pkey                                          | CREATE UNIQUE INDEX loans_pkey ON public.loans USING btree (id)
 public      | loans                 | uq_loans_one_loan_per_application                   | CREATE UNIQUE INDEX uq_loans_one_loan_per_application ON public.loans USING btree (application_id) WHERE (application_id IS NOT NULL)
 public      | payments              | idx_payments_loan                                   | CREATE INDEX idx_payments_loan ON public.payments USING btree (loan_id)
 public      | payments              | idx_payments_status                                 | CREATE INDEX idx_payments_status ON public.payments USING btree (status)
 public      | payments              | payments_pkey                                       | CREATE UNIQUE INDEX payments_pkey ON public.payments USING btree (id)
 public      | reminders             | reminders_loan_id_reminder_type_reminder_period_key | CREATE UNIQUE INDEX reminders_loan_id_reminder_type_reminder_period_key ON public.reminders USING btree (loan_id, reminder_type, reminder_period)
 public      | reminders             | reminders_pkey                                      | CREATE UNIQUE INDEX reminders_pkey ON public.reminders USING btree (id)
(28 rows)


```

## 7. Sequences

```text
 schema_name |        sequence_name         | data_type | start_value | min_value |      max_value      | increment_by | cycle | cache_size | last_value 
-------------+------------------------------+-----------+-------------+-----------+---------------------+--------------+-------+------------+------------
 public      | application_number_seq       | bigint    |           1 |         1 | 9223372036854775807 |            1 | f     |          1 |         11
 public      | applications_id_seq          | bigint    |           1 |         1 | 9223372036854775807 |            1 | f     |          1 |           
 public      | audit_events_id_seq          | bigint    |           1 |         1 | 9223372036854775807 |            1 | f     |          1 |           
 public      | communications_id_seq        | bigint    |           1 |         1 | 9223372036854775807 |            1 | f     |          1 |           
 public      | conversation_sessions_id_seq | bigint    |           1 |         1 | 9223372036854775807 |            1 | f     |          1 |           
 public      | document_extractions_id_seq  | bigint    |           1 |         1 | 9223372036854775807 |            1 | f     |          1 |           
 public      | documents_id_seq             | bigint    |           1 |         1 | 9223372036854775807 |            1 | f     |          1 |           
 public      | loans_id_seq                 | bigint    |           1 |         1 | 9223372036854775807 |            1 | f     |          1 |           
 public      | payments_id_seq              | bigint    |           1 |         1 | 9223372036854775807 |            1 | f     |          1 |           
 public      | reminders_id_seq             | bigint    |           1 |         1 | 9223372036854775807 |            1 | f     |          1 |           
(10 rows)


```

## 8. Triggers

```text
 schema_name | table_name | trigger_name | definition | enabled_state 
-------------+------------+--------------+------------+---------------
(0 rows)


```

## 9. Functions and procedures

```text
 schema_name | routine_name | routine_type | arguments | returns | language | security_definer | volatility | routine_settings 
-------------+--------------+--------------+-----------+---------+----------+------------------+------------+------------------
(0 rows)


```

## 10. Row-level security policies

```text
 schema_name | table_name | policy_name | permissive | roles | command | using_expression | check_expression 
-------------+------------+-------------+------------+-------+---------+------------------+------------------
(0 rows)


```

## 11. Table and view grants

```text
 schema_name |      table_name       | grantee  | privilege_type | is_grantable 
-------------+-----------------------+----------+----------------+--------------
 public      | applications          | loan_app | DELETE         | YES
 public      | applications          | loan_app | INSERT         | YES
 public      | applications          | loan_app | REFERENCES     | YES
 public      | applications          | loan_app | SELECT         | YES
 public      | applications          | loan_app | TRIGGER        | YES
 public      | applications          | loan_app | TRUNCATE       | YES
 public      | applications          | loan_app | UPDATE         | YES
 public      | audit_events          | loan_app | DELETE         | YES
 public      | audit_events          | loan_app | INSERT         | YES
 public      | audit_events          | loan_app | REFERENCES     | YES
 public      | audit_events          | loan_app | SELECT         | YES
 public      | audit_events          | loan_app | TRIGGER        | YES
 public      | audit_events          | loan_app | TRUNCATE       | YES
 public      | audit_events          | loan_app | UPDATE         | YES
 public      | communications        | loan_app | DELETE         | YES
 public      | communications        | loan_app | INSERT         | YES
 public      | communications        | loan_app | REFERENCES     | YES
 public      | communications        | loan_app | SELECT         | YES
 public      | communications        | loan_app | TRIGGER        | YES
 public      | communications        | loan_app | TRUNCATE       | YES
 public      | communications        | loan_app | UPDATE         | YES
 public      | conversation_sessions | loan_app | DELETE         | YES
 public      | conversation_sessions | loan_app | INSERT         | YES
 public      | conversation_sessions | loan_app | REFERENCES     | YES
 public      | conversation_sessions | loan_app | SELECT         | YES
 public      | conversation_sessions | loan_app | TRIGGER        | YES
 public      | conversation_sessions | loan_app | TRUNCATE       | YES
 public      | conversation_sessions | loan_app | UPDATE         | YES
 public      | customers             | loan_app | DELETE         | YES
 public      | customers             | loan_app | INSERT         | YES
 public      | customers             | loan_app | REFERENCES     | YES
 public      | customers             | loan_app | SELECT         | YES
 public      | customers             | loan_app | TRIGGER        | YES
 public      | customers             | loan_app | TRUNCATE       | YES
 public      | customers             | loan_app | UPDATE         | YES
 public      | document_extractions  | loan_app | DELETE         | YES
 public      | document_extractions  | loan_app | INSERT         | YES
 public      | document_extractions  | loan_app | REFERENCES     | YES
 public      | document_extractions  | loan_app | SELECT         | YES
 public      | document_extractions  | loan_app | TRIGGER        | YES
 public      | document_extractions  | loan_app | TRUNCATE       | YES
 public      | document_extractions  | loan_app | UPDATE         | YES
 public      | documents             | loan_app | DELETE         | YES
 public      | documents             | loan_app | INSERT         | YES
 public      | documents             | loan_app | REFERENCES     | YES
 public      | documents             | loan_app | SELECT         | YES
 public      | documents             | loan_app | TRIGGER        | YES
 public      | documents             | loan_app | TRUNCATE       | YES
 public      | documents             | loan_app | UPDATE         | YES
 public      | loans                 | loan_app | DELETE         | YES
 public      | loans                 | loan_app | INSERT         | YES
 public      | loans                 | loan_app | REFERENCES     | YES
 public      | loans                 | loan_app | SELECT         | YES
 public      | loans                 | loan_app | TRIGGER        | YES
 public      | loans                 | loan_app | TRUNCATE       | YES
 public      | loans                 | loan_app | UPDATE         | YES
 public      | payments              | loan_app | DELETE         | YES
 public      | payments              | loan_app | INSERT         | YES
 public      | payments              | loan_app | REFERENCES     | YES
 public      | payments              | loan_app | SELECT         | YES
 public      | payments              | loan_app | TRIGGER        | YES
 public      | payments              | loan_app | TRUNCATE       | YES
 public      | payments              | loan_app | UPDATE         | YES
 public      | reminders             | loan_app | DELETE         | YES
 public      | reminders             | loan_app | INSERT         | YES
 public      | reminders             | loan_app | REFERENCES     | YES
 public      | reminders             | loan_app | SELECT         | YES
 public      | reminders             | loan_app | TRIGGER        | YES
 public      | reminders             | loan_app | TRUNCATE       | YES
 public      | reminders             | loan_app | UPDATE         | YES
(70 rows)


```

## 12. User-defined enum, domain and range types

```text
 schema_name | type_name | type_kind | details 
-------------+-----------+-----------+---------
(0 rows)


```

## 13. Full schema DDL from pg_dump

> This is a schema-only PostgreSQL dump. It contains object definitions (tables, columns, constraints, indexes, sequences, routines, triggers and related DDL) but no table rows. Ownership reassignment commands are omitted; grants may still reference local roles and must be reviewed before restoration.

```sql
--
-- PostgreSQL database dump
--

\restrict cPfMxIw7EyyIM2WaTGFBh5JNXVjeNKFgxDV6oehaT5e4ZOFN0ePF4HpVV9HUHAg

-- Dumped from database version 18.6 (Debian 18.6-3)
-- Dumped by pg_dump version 18.6 (Debian 18.6-3)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: application_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applications (
    id bigint NOT NULL,
    application_number character varying(40) DEFAULT ('APP-'::text || lpad((nextval('public.application_number_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    customer_id uuid NOT NULL,
    borrower_type character varying(20) NOT NULL,
    requested_amount numeric(12,2) NOT NULL,
    current_step character varying(40) DEFAULT 'BORROWER_TYPE'::character varying NOT NULL,
    status character varying(30) DEFAULT 'IN_PROGRESS'::character varying NOT NULL,
    institution character varying(150),
    student_id character varying(80),
    employment_status character varying(40),
    employer character varying(150),
    reception_method character varying(40),
    reception_name character varying(150),
    reception_name_same_as_id boolean DEFAULT false NOT NULL,
    reception_identifier character varying(100),
    submitted_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    reviewed_by character varying(100),
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_amount numeric(12,2),
    CONSTRAINT applications_approved_amount_positive CHECK (((approved_amount IS NULL) OR (approved_amount > (0)::numeric)))
);


--
-- Name: applications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.applications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.applications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id bigint NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id bigint,
    event_type character varying(60) NOT NULL,
    actor_type character varying(30) NOT NULL,
    actor_id character varying(100),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: communications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communications (
    id bigint NOT NULL,
    customer_id uuid,
    application_id bigint,
    loan_id bigint,
    direction character varying(20) NOT NULL,
    channel character varying(30) NOT NULL,
    message_type character varying(50),
    provider_message_id character varying(255),
    message_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: communications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.communications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.communications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: conversation_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_sessions (
    id bigint NOT NULL,
    customer_id uuid NOT NULL,
    current_step character varying(50) DEFAULT 'BORROWER_TYPE'::character varying NOT NULL,
    borrower_type character varying(20),
    requested_amount numeric(12,2),
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT valid_session_amount CHECK (((requested_amount IS NULL) OR (requested_amount > (0)::numeric))),
    CONSTRAINT valid_session_borrower_type CHECK (((borrower_type IS NULL) OR ((borrower_type)::text = ANY ((ARRAY['STUDENT'::character varying, 'EMPLOYED'::character varying, 'UNEMPLOYED'::character varying])::text[])))),
    CONSTRAINT valid_session_status CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'COMPLETED'::character varying, 'CANCELLED'::character varying, 'EXPIRED'::character varying])::text[])))
);


--
-- Name: conversation_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.conversation_sessions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.conversation_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid NOT NULL,
    phone character varying(30) NOT NULL,
    full_name character varying(150),
    national_id character varying(50),
    borrower_type character varying(20),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_extractions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_extractions (
    id bigint NOT NULL,
    document_id bigint NOT NULL,
    extraction_engine character varying(40) DEFAULT 'tesseract'::character varying NOT NULL,
    field_name character varying(60) NOT NULL,
    extracted_value text,
    confidence numeric(5,2),
    review_status character varying(30) DEFAULT 'PENDING'::character varying NOT NULL,
    reviewed_value text,
    reviewed_by character varying(100),
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT valid_ocr_confidence CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (100)::numeric)))),
    CONSTRAINT valid_ocr_review_status CHECK (((review_status)::text = ANY ((ARRAY['PENDING'::character varying, 'ACCEPTED'::character varying, 'CORRECTED'::character varying, 'REJECTED'::character varying])::text[])))
);


--
-- Name: document_extractions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.document_extractions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.document_extractions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id bigint NOT NULL,
    application_id bigint,
    loan_id bigint,
    payment_id bigint,
    document_type character varying(60) NOT NULL,
    original_filename character varying(255) NOT NULL,
    mime_type character varying(100) NOT NULL,
    storage_provider character varying(40),
    storage_key text,
    whatsapp_media_id text,
    sha256 character varying(64),
    verification_status character varying(30) DEFAULT 'PENDING'::character varying NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    verified_by character varying(100),
    reviewed_at timestamp with time zone,
    review_note text,
    CONSTRAINT documents_one_parent CHECK ((num_nonnulls(application_id, loan_id, payment_id) = 1))
);


--
-- Name: documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.documents ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: loans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loans (
    id bigint NOT NULL,
    application_id bigint NOT NULL,
    principal numeric(12,2) NOT NULL,
    total_due numeric(12,2) NOT NULL,
    amount_paid numeric(12,2) DEFAULT 0 NOT NULL,
    outstanding_amount numeric(12,2) NOT NULL,
    due_date date,
    status character varying(30) DEFAULT 'APPROVED'::character varying NOT NULL,
    disbursement_method character varying(40),
    disbursement_reference character varying(100),
    approved_at timestamp with time zone,
    disbursed_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    interest_rate numeric(5,2),
    interest_amount numeric(12,2),
    disbursed_by text,
    CONSTRAINT loans_interest_amount_nonnegative CHECK (((interest_amount IS NULL) OR (interest_amount >= (0)::numeric))),
    CONSTRAINT loans_interest_rate_valid CHECK (((interest_rate IS NULL) OR ((interest_rate >= (0)::numeric) AND (interest_rate <= (100)::numeric))))
);


--
-- Name: loans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.loans ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.loans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id bigint NOT NULL,
    loan_id bigint NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_method character varying(40),
    payment_reference character varying(100),
    status character varying(30) DEFAULT 'PENDING'::character varying NOT NULL,
    rejection_reason text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    verified_by character varying(100)
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.payments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminders (
    id bigint NOT NULL,
    customer_id uuid NOT NULL,
    loan_id bigint NOT NULL,
    reminder_type character varying(40) NOT NULL,
    reminder_period character varying(20) NOT NULL,
    provider_message_id character varying(255),
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.reminders ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.reminders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: applications applications_application_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_application_number_key UNIQUE (application_number);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: communications communications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_pkey PRIMARY KEY (id);


--
-- Name: conversation_sessions conversation_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_sessions
    ADD CONSTRAINT conversation_sessions_pkey PRIMARY KEY (id);


--
-- Name: customers customers_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_phone_key UNIQUE (phone);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: document_extractions document_extractions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_extractions
    ADD CONSTRAINT document_extractions_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: loans loans_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_application_id_key UNIQUE (application_id);


--
-- Name: loans loans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: reminders reminders_loan_id_reminder_type_reminder_period_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_loan_id_reminder_type_reminder_period_key UNIQUE (loan_id, reminder_type, reminder_period);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: idx_applications_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_customer ON public.applications USING btree (customer_id);


--
-- Name: idx_applications_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_status ON public.applications USING btree (status);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_entity ON public.audit_events USING btree (entity_type, entity_id);


--
-- Name: idx_communications_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communications_customer ON public.communications USING btree (customer_id);


--
-- Name: idx_documents_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_application ON public.documents USING btree (application_id);


--
-- Name: idx_documents_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_payment ON public.documents USING btree (payment_id);


--
-- Name: idx_extractions_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extractions_document ON public.document_extractions USING btree (document_id);


--
-- Name: idx_extractions_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_extractions_review_status ON public.document_extractions USING btree (review_status);


--
-- Name: idx_loans_status_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loans_status_due ON public.loans USING btree (status, due_date);


--
-- Name: idx_one_active_session_per_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_one_active_session_per_customer ON public.conversation_sessions USING btree (customer_id) WHERE ((status)::text = 'ACTIVE'::text);


--
-- Name: idx_payments_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_loan ON public.payments USING btree (loan_id);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--
-- Name: uq_applications_one_active_per_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_applications_one_active_per_customer ON public.applications USING btree (customer_id) WHERE ((status)::text = ANY (ARRAY[('IN_PROGRESS'::character varying)::text, ('SUBMITTED'::character varying)::text]));


--
-- Name: uq_loans_one_loan_per_application; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_loans_one_loan_per_application ON public.loans USING btree (application_id) WHERE (application_id IS NOT NULL);


--
-- Name: applications applications_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: communications communications_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id);


--
-- Name: communications communications_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: communications communications_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: conversation_sessions conversation_sessions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_sessions
    ADD CONSTRAINT conversation_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: document_extractions document_extractions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_extractions
    ADD CONSTRAINT document_extractions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: documents documents_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id);


--
-- Name: documents documents_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: documents documents_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: loans loans_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loans
    ADD CONSTRAINT loans_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id);


--
-- Name: payments payments_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- Name: reminders reminders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: reminders reminders_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id);


--
-- PostgreSQL database dump complete
--

\unrestrict cPfMxIw7EyyIM2WaTGFBh5JNXVjeNKFgxDV6oehaT5e4ZOFN0ePF4HpVV9HUHAg


```
