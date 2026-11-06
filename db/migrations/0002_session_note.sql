-- 课次备注：停课原因等
ALTER TABLE class_sessions ADD COLUMN note text;

-- 代课不能指定成本班老师由服务端检查；这里补一个按代课老师查询的索引
CREATE INDEX class_sessions_substitute_idx ON class_sessions(substitute_teacher_id) WHERE substitute_teacher_id IS NOT NULL;
