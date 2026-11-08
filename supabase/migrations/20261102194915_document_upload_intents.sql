CREATE TABLE loanops.document_upload_intents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES loanops.customers(id),
    application_id bigint NOT NULL REFERENCES loanops.applications(id),
    document_type character varying(60) NOT NULL,
    original_filename character varying(255) NOT NULL,
    mime_type character varying(100) NOT NULL,
    expected_file_size bigint NOT NULL CHECK (expected_file_size BETWEEN 1 AND 10485760),
    object_key text NOT NULL UNIQUE,
    expires_at timestamp with time zone NOT NULL,
    status character varying(20) NOT NULL DEFAULT 'PENDING',
    completed_at timestamp with time zone,
    document_id bigint UNIQUE REFERENCES loanops.documents(id),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT document_upload_intents_status_valid
        CHECK (status IN ('PENDING', 'COMPLETED', 'REJECTED', 'EXPIRED')),
    CONSTRAINT document_upload_intents_completion_consistent
        CHECK (
            (status = 'COMPLETED' AND completed_at IS NOT NULL AND document_id IS NOT NULL)
            OR (status <> 'COMPLETED' AND completed_at IS NULL AND document_id IS NULL)
        )
);

CREATE INDEX document_upload_intents_user_application_idx
    ON loanops.document_upload_intents (user_id, application_id, created_at DESC);

ALTER TABLE loanops.document_upload_intents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE loanops.document_upload_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE loanops.document_upload_intents TO service_role;

CREATE FUNCTION loanops.finalize_document_upload(
    p_upload_intent_id uuid,
    p_user_id uuid,
    p_file_size bigint,
    p_mime_type text,
    p_sha256 text
)
RETURNS TABLE (document_id bigint, verification_status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    v_intent loanops.document_upload_intents%ROWTYPE;
    v_role text;
    v_account_status text;
    v_application_customer_id uuid;
    v_application_status text;
    v_document_id bigint;
    v_verification_status text;
BEGIN
    SELECT i.*
    INTO v_intent
    FROM loanops.document_upload_intents AS i
    WHERE i.id = p_upload_intent_id
      AND i.user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Upload intent was not found or is not owned by this user.'
            USING ERRCODE = '42501';
    END IF;

    IF v_intent.status = 'COMPLETED' THEN
        SELECT d.id, d.verification_status
        INTO v_document_id, v_verification_status
        FROM loanops.documents AS d
        WHERE d.id = v_intent.document_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Completed upload intent has no associated document.'
                USING ERRCODE = '23503';
        END IF;

        RETURN QUERY SELECT v_document_id, v_verification_status;
        RETURN;
    END IF;

    IF v_intent.status <> 'PENDING' OR v_intent.expires_at <= pg_catalog.now() THEN
        RAISE EXCEPTION 'Upload intent is no longer valid.'
            USING ERRCODE = '22023';
    END IF;

    IF p_file_size IS DISTINCT FROM v_intent.expected_file_size
       OR p_mime_type IS DISTINCT FROM v_intent.mime_type
       OR p_sha256 IS NULL
       OR p_sha256 !~ '^[0-9a-f]{64}$'
       OR v_intent.object_key !~ (
            '^borrower-documents/'
            || v_intent.application_id::text
            || '/[0-9a-f-]{36}\.(pdf|jpg|png)$'
       ) THEN
        RAISE EXCEPTION 'Verified file metadata does not match the upload intent.'
            USING ERRCODE = '22023';
    END IF;

    SELECT ur.app_role, ur.account_status
    INTO v_role, v_account_status
    FROM public.user_roles AS ur
    WHERE ur.user_id = p_user_id
    FOR SHARE;

    IF NOT FOUND OR v_role <> 'BORROWER' OR v_account_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'An active borrower account is required to finalize this upload.'
            USING ERRCODE = '42501';
    END IF;

    SELECT a.customer_id, a.status
    INTO v_application_customer_id, v_application_status
    FROM loanops.applications AS a
    WHERE a.id = v_intent.application_id
    FOR SHARE;

    IF NOT FOUND
       OR v_application_customer_id <> v_intent.customer_id
       OR v_application_customer_id <> p_user_id
       OR v_application_status <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'The application is not available for this upload.'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO loanops.documents (
        application_id,
        document_type,
        original_filename,
        mime_type,
        storage_provider,
        storage_key,
        sha256
    )
    VALUES (
        v_intent.application_id,
        v_intent.document_type,
        v_intent.original_filename,
        v_intent.mime_type,
        'CLOUDFLARE_R2',
        v_intent.object_key,
        p_sha256
    )
    RETURNING id, verification_status
    INTO v_document_id, v_verification_status;

    UPDATE loanops.document_upload_intents
    SET status = 'COMPLETED',
        completed_at = pg_catalog.now(),
        document_id = v_document_id
    WHERE id = v_intent.id;

    PERFORM loanops._audit(
        'document',
        v_document_id,
        'DOCUMENT_UPLOAD_FINALIZED',
        'BORROWER',
        p_user_id,
        pg_catalog.jsonb_build_object(
            'upload_intent_id', v_intent.id,
            'application_id', v_intent.application_id,
            'document_type', v_intent.document_type,
            'mime_type', v_intent.mime_type,
            'file_size', p_file_size,
            'sha256', p_sha256
        )
    );

    RETURN QUERY SELECT v_document_id, v_verification_status;
END;
$function$;

REVOKE ALL ON FUNCTION loanops.finalize_document_upload(uuid, uuid, bigint, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION loanops.finalize_document_upload(uuid, uuid, bigint, text, text)
    TO service_role;