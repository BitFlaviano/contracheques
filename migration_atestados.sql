-- Migration: adiciona controle de download nos atestados
ALTER TABLE atestados
    ADD COLUMN IF NOT EXISTS baixado boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS baixado_em timestamptz;
