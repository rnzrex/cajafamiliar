-- Document-First Production RPC runtime fix V1.
--
-- The original extended create_debt_v1 implementation contains one invalid
-- runtime cast for the installment number. Rebuild the same function from its
-- catalog definition, changing only that exact cast and failing closed if the
-- installed definition is not the expected one. The source fingerprint is
-- normalized to LF because the local Windows audit used CRLF while
-- PostgreSQL pg_proc.prosrc stores LF; after EOL normalization the source is
-- byte-equivalent.
do $migration$
declare
  v_signature constant text :=
    'public.create_debt_v1(uuid,uuid,text,text,text,text,date,date,numeric,numeric,integer,numeric,text,text,integer,date,numeric,numeric,text,jsonb,jsonb,text,text,numeric,text)';
  v_function oid;
  v_source text;
  v_normalized_source text;
  v_definition text;
  v_updated_definition text;
  v_bad_token constant text := '(v_elem->>''installment_number'')::pg_catalog.integer';
  v_good_token constant text := '(v_elem->>''installment_number'')::pg_catalog.int4';
  v_expected_source_md5 constant text := '67ef098b10d245ce4b22423c6a58b07e';
  v_bad_count integer;
  v_good_count integer;
  v_owner oid;
  v_acl aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_after_owner oid;
  v_after_acl aclitem[];
  v_after_security_definer boolean;
  v_after_config text[];
begin
  select p.oid, p.proowner, p.proacl, p.prosecdef, p.proconfig
    into v_function, v_owner, v_acl, v_security_definer, v_config
    from pg_catalog.pg_proc as p
   where p.oid = pg_catalog.to_regprocedure(v_signature);

  if v_function is null then
    raise exception 'Expected extended public.create_debt_v1 function was not found';
  end if;

  select pg_catalog.pg_get_functiondef(v_function)
    into v_definition;

  select p.prosrc
    into v_source
    from pg_catalog.pg_proc as p
   where p.oid = v_function;

  v_normalized_source := pg_catalog.replace(
    pg_catalog.replace(v_source, E'\r\n', E'\n'),
    E'\r',
    E'\n'
  );

  if pg_catalog.md5(v_normalized_source) <> v_expected_source_md5 then
    raise exception 'create_debt_v1 source fingerprint did not match the expected audited definition';
  end if;

  v_bad_count := (
    pg_catalog.length(v_definition) -
    pg_catalog.length(pg_catalog.replace(v_definition, v_bad_token, ''))
  ) / pg_catalog.length(v_bad_token);
  if v_bad_count <> 1 then
    raise exception 'Expected exactly one create_debt_v1 installment cast, found %', v_bad_count;
  end if;

  if pg_catalog.strpos(v_definition, v_bad_token) = 0 then
    raise exception 'create_debt_v1 definition did not match the expected installment cast';
  end if;

  v_updated_definition := pg_catalog.replace(v_definition, v_bad_token, v_good_token);
  if v_updated_definition = v_definition then
    raise exception 'create_debt_v1 definition was not changed';
  end if;

  execute pg_catalog.rtrim(v_updated_definition, E';\n\r\t ');

  select p.proowner, p.proacl, p.prosecdef, p.proconfig
    into v_after_owner, v_after_acl, v_after_security_definer, v_after_config
    from pg_catalog.pg_proc as p
   where p.oid = v_function;

  if v_after_owner is distinct from v_owner
     or v_after_acl is distinct from v_acl
     or v_after_security_definer is distinct from v_security_definer
     or v_after_config is distinct from v_config then
    raise exception 'create_debt_v1 security or privilege metadata changed unexpectedly';
  end if;

  select pg_catalog.pg_get_functiondef(v_function)
    into v_definition;
  v_bad_count := (
    pg_catalog.length(v_definition) -
    pg_catalog.length(pg_catalog.replace(v_definition, v_bad_token, ''))
  ) / pg_catalog.length(v_bad_token);
  v_good_count := (
    pg_catalog.length(v_definition) -
    pg_catalog.length(pg_catalog.replace(v_definition, v_good_token, ''))
  ) / pg_catalog.length(v_good_token);

  if v_bad_count <> 0 or v_good_count <> 1 then
    raise exception 'create_debt_v1 postcondition failed: bad casts %, corrected casts %', v_bad_count, v_good_count;
  end if;
end;
$migration$;
